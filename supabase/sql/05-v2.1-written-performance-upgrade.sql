-- =====================================================================
-- EduCore V2.1 - Written Works + Performance Tasks
-- Run this ONCE on an existing EduCore V2.0 database.
-- Keeps existing classside_* names for compatibility.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. WORK TYPE + PERFORMANCE TASK FIELDS
-- ---------------------------------------------------------------------
alter table public.classside_assignments
  add column if not exists work_type text not null default 'written_work';

alter table public.classside_assignments
  drop constraint if exists classside_assignments_work_type_check;
alter table public.classside_assignments
  add constraint classside_assignments_work_type_check
  check (work_type in ('written_work','performance_task'));

alter table public.classside_assignments
  add column if not exists max_points numeric(10,2) not null default 100
  check (max_points >= 0);

alter table public.classside_assignments
  add column if not exists rubric_path text;

alter table public.classside_assignments
  add column if not exists image_paths jsonb not null default '[]'::jsonb;

alter table public.classside_assignments
  drop constraint if exists classside_assignments_image_paths_array_check;
alter table public.classside_assignments
  add constraint classside_assignments_image_paths_array_check
  check (jsonb_typeof(image_paths) = 'array');

update public.classside_assignments
set image_paths = jsonb_build_array(image_path)
where image_path is not null
  and (image_paths is null or image_paths = '[]'::jsonb);

create index if not exists classside_assignments_work_type_idx
  on public.classside_assignments(teacher_id, work_type, created_at desc);

-- ---------------------------------------------------------------------
-- 2. MULTIPLE STUDENT OUTPUT PICTURES
-- ---------------------------------------------------------------------
alter table public.classside_submissions
  add column if not exists proof_paths jsonb not null default '[]'::jsonb;

alter table public.classside_submissions
  drop constraint if exists classside_submissions_proof_paths_array_check;
alter table public.classside_submissions
  add constraint classside_submissions_proof_paths_array_check
  check (jsonb_typeof(proof_paths) = 'array');

update public.classside_submissions
set proof_paths = jsonb_build_array(proof_path)
where proof_path is not null
  and (proof_paths is null or proof_paths = '[]'::jsonb);

-- ---------------------------------------------------------------------
-- 3. GENERIC STUDENT SUBMISSION RPC
--    Written works may send answers; performance tasks may send [] answers.
-- ---------------------------------------------------------------------
create or replace function public.classside_submit_work(
  p_assignment_id uuid,
  p_answers jsonb default '[]'::jsonb,
  p_proof_paths jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.classside_assignments;
  v_existing public.classside_submissions;
  v_submission_id uuid;
  v_auto_score numeric(10,2) := 0;
  v_attempt integer := 1;
  v_answer jsonb;
  v_question public.classside_questions;
  v_key text;
  v_text text;
  v_correct boolean;
  v_paths jsonb := case when jsonb_typeof(coalesce(p_proof_paths,'[]'::jsonb))='array' then coalesce(p_proof_paths,'[]'::jsonb) else '[]'::jsonb end;
  v_first_path text;
  v_path_item text;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if not classside_private.is_student(v_uid) then raise exception 'Only student accounts can submit classwork.'; end if;

  select * into v_assignment
  from public.classside_assignments
  where id = p_assignment_id and status = 'published';

  if v_assignment.id is null then raise exception 'Classwork not found.'; end if;
  if not classside_private.student_in_section(v_assignment.section_id, v_uid) then
    raise exception 'This classwork is not assigned to your section.';
  end if;

  if jsonb_array_length(v_paths) > 8 then
    raise exception 'Too many uploaded files.';
  end if;

  for v_path_item in
    select elem #>> '{}'
    from jsonb_array_elements(v_paths) as supplied_path(elem)
  loop
    if v_path_item is null
       or v_path_item not like v_uid::text || '/' || p_assignment_id::text || '/%' then
      raise exception 'Invalid upload path for this submission.';
    end if;
  end loop;

  select elem #>> '{}'
  into v_first_path
  from jsonb_array_elements(v_paths) as path_item(elem)
  limit 1;

  select * into v_existing
  from public.classside_submissions
  where assignment_id = p_assignment_id and student_id = v_uid
  for update;

  if v_existing.id is not null then
    if not v_assignment.allow_resubmission then raise exception 'This classwork has already been submitted.'; end if;
    v_submission_id := v_existing.id;
    v_attempt := v_existing.attempt_count + 1;

    delete from public.classside_submission_answers where submission_id = v_submission_id;

    if jsonb_array_length(v_paths) = 0 then
      v_paths := coalesce(v_existing.proof_paths,'[]'::jsonb);
      v_first_path := v_existing.proof_path;
    end if;

    update public.classside_submissions
    set status='submitted', proof_path=v_first_path, proof_paths=v_paths,
        auto_score=0, teacher_score=null, feedback=null,
        attempt_count=v_attempt, submitted_at=now(), graded_at=null, graded_by=null
    where id=v_submission_id;
  else
    insert into public.classside_submissions(assignment_id,student_id,proof_path,proof_paths,status)
    values(p_assignment_id,v_uid,v_first_path,v_paths,'submitted')
    returning id into v_submission_id;
  end if;

  for v_answer in
    select value from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb))
  loop
    select q.* into v_question
    from public.classside_questions q
    where q.id = classside_private.safe_uuid(v_answer->>'question_id')
      and q.assignment_id = p_assignment_id;
    if v_question.id is null then continue; end if;

    select k.correct_answer into v_key
    from public.classside_question_keys k where k.question_id=v_question.id;
    v_text := coalesce(v_answer->>'answer','');
    v_correct := length(btrim(coalesce(v_key,''))) > 0 and lower(btrim(v_text)) = lower(btrim(v_key));

    insert into public.classside_submission_answers(submission_id,question_id,answer_text,is_correct,awarded_points)
    values(v_submission_id,v_question.id,v_text,v_correct,case when v_correct then v_question.max_points else 0 end);
    if v_correct then v_auto_score := v_auto_score + v_question.max_points; end if;
  end loop;

  update public.classside_submissions set auto_score=v_auto_score where id=v_submission_id;

  return jsonb_build_object('submission_id',v_submission_id,'auto_score',v_auto_score,'attempt_count',v_attempt);
end;
$$;

revoke all on function public.classside_submit_work(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.classside_submit_work(uuid,jsonb,jsonb) to authenticated;

-- Backward-compatible written-work RPC used by older cached front ends.
create or replace function public.classside_submit_assignment(
  p_assignment_id uuid,
  p_answers jsonb,
  p_proof_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.classside_submit_work(
    p_assignment_id,
    coalesce(p_answers,'[]'::jsonb),
    case when p_proof_path is null or btrim(p_proof_path)='' then '[]'::jsonb else jsonb_build_array(p_proof_path) end
  );
end;
$$;

revoke all on function public.classside_submit_assignment(uuid,jsonb,text) from public, anon;
grant execute on function public.classside_submit_assignment(uuid,jsonb,text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. GRADING: PERFORMANCE TASKS USE assignment.max_points
-- ---------------------------------------------------------------------
create or replace function public.classside_grade_submission(
  p_submission_id uuid,
  p_teacher_score numeric,
  p_feedback text default null
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
  v_max_score numeric(10,2);
begin
  if v_uid is null or not classside_private.is_teacher(v_uid) then raise exception 'Only teachers can grade submissions.'; end if;

  select * into v_submission from public.classside_submissions where id=p_submission_id for update;
  if v_submission.id is null then raise exception 'Submission not found.'; end if;

  select * into v_assignment from public.classside_assignments where id=v_submission.assignment_id;
  if v_assignment.teacher_id <> v_uid then raise exception 'You do not own this classwork.'; end if;

  if v_assignment.work_type = 'performance_task' then
    v_max_score := coalesce(v_assignment.max_points,0);
  else
    select coalesce(sum(q.max_points),0) into v_max_score
    from public.classside_questions q where q.assignment_id=v_assignment.id;
  end if;

  if p_teacher_score is not null and p_teacher_score < 0 then raise exception 'Score cannot be negative.'; end if;
  if p_teacher_score is not null and p_teacher_score > v_max_score then raise exception 'Score cannot exceed %.',v_max_score; end if;

  update public.classside_submissions
  set teacher_score=p_teacher_score, feedback=p_feedback, status='graded', graded_at=now(), graded_by=v_uid
  where id=p_submission_id;

  return jsonb_build_object('submission_id',p_submission_id,'auto_score',v_submission.auto_score,'teacher_score',p_teacher_score);
end;
$$;

revoke all on function public.classside_grade_submission(uuid,numeric,text) from public, anon;
grant execute on function public.classside_grade_submission(uuid,numeric,text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. TYPE-AWARE NOTIFICATIONS
-- ---------------------------------------------------------------------
create or replace function classside_private.notify_assignment_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  if tg_op='INSERT' then
    if new.status <> 'published' then return new; end if;
  elsif tg_op='UPDATE' then
    if new.status <> 'published' or old.status='published' then return new; end if;
  end if;

  v_label := case when new.work_type='performance_task' then 'performance task' else 'written work' end;
  insert into public.classside_notifications(user_id,type,title,body,related_assignment_id)
  select m.student_id,'assignment',
         case when new.work_type='performance_task' then 'New performance task' else 'New written work' end,
         new.title || case when new.due_at is not null then ' · Due ' || to_char(new.due_at at time zone 'UTC','Mon DD') else '' end,
         new.id
  from public.classside_section_members m where m.section_id=new.section_id;
  return new;
end;
$$;

create or replace function classside_private.notify_submission_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.classside_assignments;
  v_student_name text;
  v_label text;
begin
  select * into v_assignment from public.classside_assignments where id=new.assignment_id;
  select p.display_name into v_student_name from public.classside_profiles p where p.id=new.student_id;
  v_label := case when v_assignment.work_type='performance_task' then 'performance task' else 'written work' end;

  if tg_op='INSERT' then
    insert into public.classside_notifications(user_id,type,title,body,related_assignment_id,related_submission_id)
    values(v_assignment.teacher_id,'submission','New submission',coalesce(v_student_name,'A student') || ' submitted ' || coalesce(v_assignment.title,'a '||v_label) || '.',new.assignment_id,new.id);
  elsif tg_op='UPDATE' then
    if new.attempt_count > old.attempt_count then
      insert into public.classside_notifications(user_id,type,title,body,related_assignment_id,related_submission_id)
      values(v_assignment.teacher_id,'submission',case when v_assignment.work_type='performance_task' then 'Performance task resubmitted' else 'Written work resubmitted' end,
             coalesce(v_student_name,'A student') || ' sent attempt ' || new.attempt_count || ' for ' || coalesce(v_assignment.title,'a '||v_label) || '.',new.assignment_id,new.id);
    end if;
    if new.status='graded' and (old.status is distinct from 'graded' or new.graded_at is distinct from old.graded_at) then
      insert into public.classside_notifications(user_id,type,title,body,related_assignment_id,related_submission_id)
      values(new.student_id,'feedback','New teacher feedback',coalesce(v_assignment.title,'Your '||v_label) || ' has been reviewed.',new.assignment_id,new.id);
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. RUBRIC FILE TYPES IN EXISTING ASSIGNMENT-MEDIA BUCKET
-- ---------------------------------------------------------------------
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id='classside-assignment-images';

commit;
notify pgrst, 'reload schema';
