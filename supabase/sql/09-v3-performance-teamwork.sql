-- EduCore V19 — Performance Task teamwork, leaders, and private participation ratings
-- Run after 09-v18-math-autocorrect-canonicalization.sql.

alter table public.classside_assignments
  add column if not exists collaboration_mode text not null default 'individual';

alter table public.classside_assignments
  drop constraint if exists classside_assignments_collaboration_mode_check;
alter table public.classside_assignments
  add constraint classside_assignments_collaboration_mode_check
  check (collaboration_mode in ('individual','pair','group'));

alter table public.classside_assignments
  add column if not exists grouping_creator text not null default 'teacher';

alter table public.classside_assignments
  drop constraint if exists classside_assignments_grouping_creator_check;
alter table public.classside_assignments
  add constraint classside_assignments_grouping_creator_check
  check (grouping_creator in ('teacher','students'));

alter table public.classside_assignments
  add column if not exists group_count integer;

alter table public.classside_assignments
  drop constraint if exists classside_assignments_group_count_check;
alter table public.classside_assignments
  add constraint classside_assignments_group_count_check
  check (group_count is null or group_count between 1 and 100);

create table if not exists public.classside_performance_groups (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.classside_assignments(id) on delete cascade,
  section_id uuid not null references public.classside_sections(id) on delete cascade,
  name text not null,
  leader_id uuid references public.classside_profiles(id) on delete set null,
  created_by text not null default 'teacher' check (created_by in ('teacher','students')),
  created_at timestamptz not null default now()
);

create index if not exists classside_performance_groups_assignment_idx
  on public.classside_performance_groups(assignment_id);

create table if not exists public.classside_performance_group_members (
  group_id uuid not null references public.classside_performance_groups(id) on delete cascade,
  assignment_id uuid not null references public.classside_assignments(id) on delete cascade,
  student_id uuid not null references public.classside_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('leader','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, student_id),
  unique (assignment_id, student_id)
);

create index if not exists classside_performance_members_assignment_idx
  on public.classside_performance_group_members(assignment_id, student_id);

create table if not exists public.classside_performance_participation_ratings (
  assignment_id uuid not null references public.classside_assignments(id) on delete cascade,
  group_id uuid not null references public.classside_performance_groups(id) on delete cascade,
  leader_id uuid not null references public.classside_profiles(id) on delete cascade,
  member_id uuid not null references public.classside_profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (assignment_id, member_id)
);

alter table public.classside_performance_groups enable row level security;
alter table public.classside_performance_group_members enable row level security;
alter table public.classside_performance_participation_ratings enable row level security;

-- Team details are intentionally exposed through the RPC functions below so
-- private leader ratings are never generally readable through the REST table API.
revoke all on public.classside_performance_groups from anon, authenticated;
revoke all on public.classside_performance_group_members from anon, authenticated;
revoke all on public.classside_performance_participation_ratings from anon, authenticated;

create or replace function classside_private.performance_assignment_teacher(p_assignment_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classside_assignments a
    where a.id = p_assignment_id and a.teacher_id = p_uid
  );
$$;

create or replace function classside_private.student_in_performance_group(p_group_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.classside_performance_group_members gm
    where gm.group_id = p_group_id and gm.student_id = p_uid
  );
$$;

create or replace function public.classside_generate_performance_groups(
  p_assignment_id uuid,
  p_group_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.classside_assignments;
  v_students uuid[];
  v_student uuid;
  v_total integer := 0;
  v_count integer := 0;
  v_idx integer := 0;
  v_target integer;
  v_group_ids uuid[] := '{}';
  v_group_id uuid;
  v_name text;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  select * into v_assignment from public.classside_assignments where id = p_assignment_id;
  if v_assignment.id is null then raise exception 'Performance task not found.'; end if;
  if v_assignment.teacher_id <> v_uid or not classside_private.is_teacher(v_uid) then
    raise exception 'Only the teacher can generate teams.';
  end if;
  if coalesce(v_assignment.work_type,'written_work') <> 'performance_task' then
    raise exception 'This is not a performance task.';
  end if;

  delete from public.classside_performance_groups where assignment_id = p_assignment_id;
  if coalesce(v_assignment.collaboration_mode,'individual') = 'individual' then
    return jsonb_build_object('groups',0,'students',0);
  end if;

  select coalesce(array_agg(sm.student_id order by p.display_name, sm.student_id), '{}'), count(*)
    into v_students, v_total
  from public.classside_section_members sm
  join public.classside_profiles p on p.id = sm.student_id
  where sm.section_id = v_assignment.section_id;

  if v_total = 0 then return jsonb_build_object('groups',0,'students',0); end if;

  if v_assignment.collaboration_mode = 'pair' then
    v_count := ceil(v_total / 2.0)::integer;
  else
    v_count := coalesce(p_group_count, v_assignment.group_count, 1);
    v_count := greatest(1, least(v_total, v_count));
  end if;

  for v_idx in 1..v_count loop
    v_name := case when v_assignment.collaboration_mode = 'pair' then 'Pair ' else 'Group ' end || v_idx::text;
    insert into public.classside_performance_groups(assignment_id,section_id,name,created_by)
    values(p_assignment_id,v_assignment.section_id,v_name,'teacher')
    returning id into v_group_id;
    v_group_ids := array_append(v_group_ids,v_group_id);
  end loop;

  v_idx := 0;
  foreach v_student in array v_students loop
    v_target := mod(v_idx, v_count) + 1;
    v_group_id := v_group_ids[v_target];
    insert into public.classside_performance_group_members(group_id,assignment_id,student_id,role)
    values(v_group_id,p_assignment_id,v_student,case when v_idx < v_count then 'leader' else 'member' end);
    if v_idx < v_count then
      update public.classside_performance_groups set leader_id = v_student where id = v_group_id;
    end if;
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object('groups',v_count,'students',v_total);
end;
$$;

create or replace function public.classside_get_performance_team(
  p_assignment_id uuid,
  p_student_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.classside_assignments;
  v_student_id uuid;
  v_group public.classside_performance_groups;
  v_members jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  select * into v_assignment from public.classside_assignments where id = p_assignment_id;
  if v_assignment.id is null then raise exception 'Performance task not found.'; end if;

  if p_student_id is not null and p_student_id <> v_uid then
    if v_assignment.teacher_id <> v_uid then raise exception 'You cannot view this team.'; end if;
    v_student_id := p_student_id;
  else
    v_student_id := v_uid;
    if v_assignment.teacher_id <> v_uid and not classside_private.student_in_section(v_assignment.section_id, v_uid) then
      raise exception 'This performance task is not assigned to you.';
    end if;
  end if;

  if coalesce(v_assignment.collaboration_mode,'individual') = 'individual' then
    return jsonb_build_object(
      'mode','individual','grouping_creator',coalesce(v_assignment.grouping_creator,'teacher'),
      'group_count',v_assignment.group_count,'group',null,'leader_id',null,
      'is_leader',false,'members','[]'::jsonb
    );
  end if;

  select g.* into v_group
  from public.classside_performance_group_members gm
  join public.classside_performance_groups g on g.id = gm.group_id
  where gm.assignment_id = p_assignment_id and gm.student_id = v_student_id
  limit 1;

  if v_group.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name,
      'role', gm.role
    ) order by case when gm.role='leader' then 0 else 1 end, p.display_name), '[]'::jsonb)
    into v_members
    from public.classside_performance_group_members gm
    join public.classside_profiles p on p.id = gm.student_id
    where gm.group_id = v_group.id;
  end if;

  return jsonb_build_object(
    'mode',coalesce(v_assignment.collaboration_mode,'individual'),
    'grouping_creator',coalesce(v_assignment.grouping_creator,'teacher'),
    'group_count',v_assignment.group_count,
    'group',case when v_group.id is null then null else jsonb_build_object('id',v_group.id,'name',v_group.name) end,
    'leader_id',v_group.leader_id,
    'is_leader',v_group.leader_id = v_uid,
    'members',v_members
  );
end;
$$;

create or replace function public.classside_get_available_groupmates(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.classside_assignments;
  v_total integer := 0;
  v_max_members integer := 2;
  v_students jsonb := '[]'::jsonb;
begin
  if v_uid is null or not classside_private.is_student(v_uid) then raise exception 'Student account required.'; end if;
  select * into v_assignment from public.classside_assignments where id=p_assignment_id and status='published';
  if v_assignment.id is null then raise exception 'Performance task not found.'; end if;
  if coalesce(v_assignment.work_type,'written_work') <> 'performance_task'
     or coalesce(v_assignment.collaboration_mode,'individual') = 'individual'
     or coalesce(v_assignment.grouping_creator,'teacher') <> 'students' then
    raise exception 'Student-created teams are not enabled for this task.';
  end if;
  if not classside_private.student_in_section(v_assignment.section_id,v_uid) then raise exception 'This task is not assigned to you.'; end if;
  if exists(select 1 from public.classside_performance_group_members where assignment_id=p_assignment_id and student_id=v_uid) then
    return jsonb_build_object('students','[]'::jsonb,'max_members',2);
  end if;

  select count(*) into v_total from public.classside_section_members where section_id=v_assignment.section_id;
  if v_assignment.collaboration_mode='pair' then
    v_max_members := 2;
  else
    v_max_members := greatest(2, ceil(v_total::numeric / greatest(1,coalesce(v_assignment.group_count,1)))::integer);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name) order by p.display_name),'[]'::jsonb)
  into v_students
  from public.classside_section_members sm
  join public.classside_profiles p on p.id=sm.student_id
  where sm.section_id=v_assignment.section_id
    and sm.student_id<>v_uid
    and not exists(
      select 1 from public.classside_performance_group_members gm
      where gm.assignment_id=p_assignment_id and gm.student_id=sm.student_id
    );

  return jsonb_build_object('students',v_students,'max_members',v_max_members);
end;
$$;

create or replace function public.classside_create_student_performance_team(
  p_assignment_id uuid,
  p_member_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.classside_assignments;
  v_total integer := 0;
  v_max_members integer := 2;
  v_selected integer := coalesce(array_length(p_member_ids,1),0);
  v_member uuid;
  v_group_id uuid;
  v_group_number integer;
  v_name text;
begin
  if v_uid is null or not classside_private.is_student(v_uid) then raise exception 'Student account required.'; end if;
  select * into v_assignment from public.classside_assignments where id=p_assignment_id and status='published';
  if v_assignment.id is null then raise exception 'Performance task not found.'; end if;
  if coalesce(v_assignment.grouping_creator,'teacher') <> 'students' or coalesce(v_assignment.collaboration_mode,'individual')='individual' then
    raise exception 'Student-created teams are not enabled for this task.';
  end if;
  if not classside_private.student_in_section(v_assignment.section_id,v_uid) then raise exception 'This task is not assigned to you.'; end if;
  if exists(select 1 from public.classside_performance_group_members where assignment_id=p_assignment_id and student_id=v_uid) then
    raise exception 'You already belong to a team for this task.';
  end if;

  select count(*) into v_total from public.classside_section_members where section_id=v_assignment.section_id;
  if v_assignment.collaboration_mode='pair' then
    v_max_members := 2;
    if v_selected <> 1 then raise exception 'Choose exactly one classmate for your pair.'; end if;
  else
    v_max_members := greatest(2, ceil(v_total::numeric / greatest(1,coalesce(v_assignment.group_count,1)))::integer);
    if v_selected < 1 or v_selected > v_max_members-1 then
      raise exception 'Choose between 1 and % classmates for this group.', v_max_members-1;
    end if;
  end if;

  foreach v_member in array p_member_ids loop
    if v_member = v_uid then raise exception 'You are already included as the team leader.'; end if;
    if not exists(select 1 from public.classside_section_members where section_id=v_assignment.section_id and student_id=v_member) then
      raise exception 'One selected student is not available for this team.';
    end if;
    if exists(select 1 from public.classside_performance_group_members where assignment_id=p_assignment_id and student_id=v_member) then
      raise exception 'One selected student already belongs to another team.';
    end if;
  end loop;

  select count(*)+1 into v_group_number from public.classside_performance_groups where assignment_id=p_assignment_id;
  v_name := case when v_assignment.collaboration_mode='pair' then 'Pair ' else 'Group ' end || v_group_number::text;
  insert into public.classside_performance_groups(assignment_id,section_id,name,leader_id,created_by)
  values(p_assignment_id,v_assignment.section_id,v_name,v_uid,'students') returning id into v_group_id;
  insert into public.classside_performance_group_members(group_id,assignment_id,student_id,role)
  values(v_group_id,p_assignment_id,v_uid,'leader');
  foreach v_member in array p_member_ids loop
    insert into public.classside_performance_group_members(group_id,assignment_id,student_id,role)
    values(v_group_id,p_assignment_id,v_member,'member');
  end loop;
  return jsonb_build_object('group_id',v_group_id,'name',v_name);
end;
$$;

create or replace function public.classside_save_participation_ratings(
  p_assignment_id uuid,
  p_group_id uuid,
  p_ratings jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_member uuid;
  v_rating integer;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if not exists(
    select 1 from public.classside_performance_groups g
    where g.id=p_group_id and g.assignment_id=p_assignment_id and g.leader_id=v_uid
  ) then raise exception 'Only the team leader can save participation ratings.'; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_ratings,'[]'::jsonb)) loop
    begin v_member := (v_item->>'member_id')::uuid; exception when others then raise exception 'Invalid member rating.'; end;
    v_rating := (v_item->>'rating')::integer;
    if v_rating not between 1 and 5 then raise exception 'Ratings must be from 1 to 5.'; end if;
    if v_member=v_uid or not exists(select 1 from public.classside_performance_group_members where group_id=p_group_id and student_id=v_member) then
      raise exception 'Invalid team member rating.';
    end if;
    insert into public.classside_performance_participation_ratings(assignment_id,group_id,leader_id,member_id,rating,updated_at)
    values(p_assignment_id,p_group_id,v_uid,v_member,v_rating,now())
    on conflict(assignment_id,member_id) do update set
      group_id=excluded.group_id, leader_id=excluded.leader_id, rating=excluded.rating, updated_at=now();
  end loop;
end;
$$;

create or replace function public.classside_get_participation_ratings(
  p_assignment_id uuid,
  p_group_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
  v_data jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  select (
    a.teacher_id=v_uid or g.leader_id=v_uid
  ) into v_allowed
  from public.classside_performance_groups g
  join public.classside_assignments a on a.id=g.assignment_id
  where g.id=p_group_id and g.assignment_id=p_assignment_id;
  if not coalesce(v_allowed,false) then raise exception 'These participation ratings are private.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'member_id',r.member_id,
    'display_name',p.display_name,
    'rating',r.rating
  ) order by p.display_name),'[]'::jsonb)
  into v_data
  from public.classside_performance_participation_ratings r
  join public.classside_profiles p on p.id=r.member_id
  where r.assignment_id=p_assignment_id and r.group_id=p_group_id;
  return v_data;
end;
$$;

-- If the teacher changes the collaboration setup, remove old team records so
-- they cannot conflict with the new setup. Teacher-generated teams are rebuilt
-- by classside_generate_performance_groups immediately after save.
create or replace function classside_private.reset_performance_groups_on_setup_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.collaboration_mode is distinct from new.collaboration_mode
     or old.grouping_creator is distinct from new.grouping_creator
     or old.group_count is distinct from new.group_count then
    delete from public.classside_performance_groups where assignment_id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists classside_performance_setup_reset on public.classside_assignments;
create trigger classside_performance_setup_reset
after update of collaboration_mode, grouping_creator, group_count on public.classside_assignments
for each row execute function classside_private.reset_performance_groups_on_setup_change();

-- Replace the submission RPC so collaborative performance-task output can only
-- be submitted by the saved team leader. Individual activities keep their
-- existing behavior and math auto-correct normalization.
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
  if v_assignment.id is null then raise exception 'This activity is closed or archived.'; end if;
  if not classside_private.student_in_section(v_assignment.section_id, v_uid) then
    raise exception 'This classwork is not assigned to your section.';
  end if;

  if coalesce(v_assignment.work_type,'written_work')='performance_task'
     and coalesce(v_assignment.collaboration_mode,'individual') <> 'individual'
     and not exists(
       select 1 from public.classside_performance_groups g
       where g.assignment_id=p_assignment_id and g.leader_id=v_uid
     ) then
    raise exception 'Only your team leader can submit this performance task.';
  end if;

  if jsonb_array_length(v_paths) < 1 then raise exception 'Upload at least one solution or output picture before submitting.'; end if;
  if jsonb_array_length(v_paths) > 10 then raise exception 'Choose up to 10 uploaded pictures for one submission.'; end if;

  for v_path_item in select elem #>> '{}' from jsonb_array_elements(v_paths) as supplied_path(elem) loop
    if v_path_item is null or v_path_item not like v_uid::text || '/' || p_assignment_id::text || '/%' then
      raise exception 'Invalid upload path for this submission.';
    end if;
  end loop;

  select elem #>> '{}' into v_first_path from jsonb_array_elements(v_paths) as path_item(elem) limit 1;

  select * into v_existing from public.classside_submissions
  where assignment_id = p_assignment_id and student_id = v_uid for update;

  if v_existing.id is not null then
    if not v_assignment.allow_resubmission then raise exception 'This classwork has already been submitted.'; end if;
    if not coalesce(v_existing.resubmit_allowed,false) then raise exception 'Your teacher has not allowed another attempt yet.'; end if;
    v_submission_id := v_existing.id;
    v_attempt := v_existing.attempt_count + 1;
    delete from public.classside_submission_answers where submission_id = v_submission_id;
    update public.classside_submissions
    set status='submitted', proof_path=v_first_path, proof_paths=v_paths,
        auto_score=0, teacher_score=null, feedback=null,
        attempt_count=v_attempt, submitted_at=now(), graded_at=null, graded_by=null,
        resubmit_allowed=false, updated_at=now()
    where id=v_submission_id;
  else
    insert into public.classside_submissions(assignment_id,student_id,proof_path,proof_paths,status,resubmit_allowed)
    values(p_assignment_id,v_uid,v_first_path,v_paths,'submitted',false)
    returning id into v_submission_id;
  end if;

  for v_answer in select value from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb)) loop
    select q.* into v_question from public.classside_questions q
    where q.id = classside_private.safe_uuid(v_answer->>'question_id') and q.assignment_id = p_assignment_id;
    if v_question.id is null then continue; end if;
    select k.correct_answer into v_key from public.classside_question_keys k where k.question_id=v_question.id;
    v_text := coalesce(v_answer->>'answer','');
    v_correct := length(classside_private.normalize_math_answer(v_key)) > 0
      and classside_private.normalize_math_answer(v_text) = classside_private.normalize_math_answer(v_key);
    insert into public.classside_submission_answers(submission_id,question_id,answer_text,is_correct,manual_is_correct,awarded_points)
    values(v_submission_id,v_question.id,v_text,v_correct,null,case when v_correct then v_question.max_points else 0 end);
    if v_correct then v_auto_score := v_auto_score + v_question.max_points; end if;
  end loop;

  update public.classside_submissions set auto_score=v_auto_score, updated_at=now() where id=v_submission_id;
  return jsonb_build_object('submission_id',v_submission_id,'auto_score',v_auto_score,'attempt_count',v_attempt,'proof_paths',v_paths);
end;
$$;

revoke all on function public.classside_generate_performance_groups(uuid,integer) from public, anon;
revoke all on function public.classside_get_performance_team(uuid,uuid) from public, anon;
revoke all on function public.classside_get_available_groupmates(uuid) from public, anon;
revoke all on function public.classside_create_student_performance_team(uuid,uuid[]) from public, anon;
revoke all on function public.classside_save_participation_ratings(uuid,uuid,jsonb) from public, anon;
revoke all on function public.classside_get_participation_ratings(uuid,uuid) from public, anon;
revoke all on function public.classside_submit_work(uuid,jsonb,jsonb) from public, anon;

grant execute on function public.classside_generate_performance_groups(uuid,integer) to authenticated;
grant execute on function public.classside_get_performance_team(uuid,uuid) to authenticated;
grant execute on function public.classside_get_available_groupmates(uuid) to authenticated;
grant execute on function public.classside_create_student_performance_team(uuid,uuid[]) to authenticated;
grant execute on function public.classside_save_participation_ratings(uuid,uuid,jsonb) to authenticated;
grant execute on function public.classside_get_participation_ratings(uuid,uuid) to authenticated;
grant execute on function public.classside_submit_work(uuid,jsonb,jsonb) to authenticated;
