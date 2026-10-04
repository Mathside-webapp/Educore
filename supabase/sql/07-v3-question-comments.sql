-- EduCore V13 upgrade
-- Adds per-question teacher comments and refreshes the submission review RPC.

alter table if exists public.classside_submission_answers
  add column if not exists teacher_comment text;

create or replace function public.classside_save_submission_review(
  p_submission_id uuid,
  p_teacher_score numeric default null,
  p_feedback text default null,
  p_answer_reviews jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_submission public.classside_submissions;
  v_assignment public.classside_assignments;
  v_review jsonb;
  v_question_id uuid;
  v_correct boolean;
  v_manual_count integer := 0;
  v_manual_score numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_effective_score numeric(10,2);
  v_teacher_comment text;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if not classside_private.is_teacher(v_uid) then raise exception 'Only teachers can review submissions.'; end if;

  select * into v_submission
  from public.classside_submissions
  where id = p_submission_id
  for update;
  if v_submission.id is null then raise exception 'Submission not found.'; end if;

  select * into v_assignment
  from public.classside_assignments
  where id = v_submission.assignment_id;
  if v_assignment.id is null or v_assignment.teacher_id <> v_uid then raise exception 'You do not own this submission.'; end if;

  select coalesce(sum(q.max_points),0) into v_total
  from public.classside_questions q
  where q.assignment_id = v_assignment.id;

  for v_review in select value from jsonb_array_elements(coalesce(p_answer_reviews,'[]'::jsonb))
  loop
    v_question_id := classside_private.safe_uuid(v_review->>'question_id');
    if v_question_id is null then continue; end if;
    v_correct := coalesce((v_review->>'is_correct')::boolean,false);
    v_teacher_comment := nullif(btrim(coalesce(v_review->>'teacher_comment','')),'');

    update public.classside_submission_answers a
    set manual_is_correct = v_correct,
        awarded_points = case when v_correct then q.max_points else 0 end,
        teacher_comment = v_teacher_comment
    from public.classside_questions q
    where a.submission_id = p_submission_id
      and a.question_id = v_question_id
      and q.id = a.question_id
      and q.assignment_id = v_assignment.id;
  end loop;

  select count(*), coalesce(sum(case when coalesce(a.manual_is_correct,a.is_correct,false) then q.max_points else 0 end),0)
  into v_manual_count, v_manual_score
  from public.classside_submission_answers a
  join public.classside_questions q on q.id = a.question_id
  where a.submission_id = p_submission_id
    and a.manual_is_correct is not null;

  if v_manual_count > 0 then
    select coalesce(sum(case when coalesce(a.manual_is_correct,a.is_correct,false) then q.max_points else 0 end),0)
    into v_effective_score
    from public.classside_submission_answers a
    join public.classside_questions q on q.id = a.question_id
    where a.submission_id = p_submission_id;
  else
    v_effective_score := p_teacher_score;
  end if;

  if v_effective_score is not null and (v_effective_score < 0 or v_effective_score > v_total) then
    raise exception 'Teacher score must be between 0 and %.', v_total;
  end if;

  update public.classside_submissions
  set teacher_score = v_effective_score,
      feedback = nullif(btrim(coalesce(p_feedback,'')),'') ,
      status = 'graded',
      graded_at = now(),
      graded_by = v_uid,
      updated_at = now()
  where id = p_submission_id;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'teacher_score', v_effective_score,
    'total_points', v_total,
    'manual_review_count', v_manual_count,
    'manual_review_score', v_manual_score
  );
end;
$$;

revoke all on function public.classside_save_submission_review(uuid,numeric,text,jsonb) from public, anon;
grant execute on function public.classside_save_submission_review(uuid,numeric,text,jsonb) to authenticated;
