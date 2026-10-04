-- =====================================================================
-- EDUCORE — MULTI-SUBJECT COMPLETE SETUP
-- COMPLETE SUPABASE DATABASE / RLS / STORAGE SETUP
-- =====================================================================
-- IMPORTANT:
-- 1) Run this in a NEW EduCore Supabase project.
-- 2) Teachers may register normally. New teacher profiles start as pending_teacher.
--    An administrator approves them by converting the profile role to teacher.
-- 3) This package's app.js uses Supabase Auth, Database, Storage and RPCs.
-- 4) Automatic student account creation is handled by the included
--    create-students Edge Function. Never put a secret/service-role key
--    in frontend JavaScript.
-- =====================================================================

begin;

create extension if not exists pgcrypto;

create schema if not exists classside_private;
revoke all on schema classside_private from public;
grant usage on schema classside_private to authenticated, anon;

-- ---------------------------------------------------------------------
-- 1. LEGACY TEACHER ALLOWLIST (NO LONGER REQUIRED)
-- ---------------------------------------------------------------------
-- Retained only so V1 projects can upgrade safely without dropping data.
-- V1.1 teacher signup no longer checks this table. New teacher accounts are
-- inserted as pending_teacher and must be approved by an administrator.

create table if not exists public.classside_teacher_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.classside_teacher_allowlist enable row level security;
revoke all on public.classside_teacher_allowlist from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. PROFILES
-- ---------------------------------------------------------------------

create table if not exists public.classside_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'student'
    check (role in ('pending_teacher','teacher','student')),
  subject text
    check (subject is null or subject in ('English','Filipino','Araling Panlipunan','Science','ESP','TLE','MAPEH')),
  username text unique,
  gender text
    check (gender is null or gender in ('Female','Male','Prefer not to say','Not specified')),
  grade_level integer
    check (grade_level is null or grade_level between 7 and 12),
  avatar_path text,
  created_by_teacher uuid references public.classside_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.classside_profiles
  drop constraint if exists classside_profiles_role_check;
alter table public.classside_profiles
  add constraint classside_profiles_role_check
  check (role in ('pending_teacher','teacher','student'));

create index if not exists classside_profiles_role_idx
  on public.classside_profiles(role);

create index if not exists classside_profiles_grade_idx
  on public.classside_profiles(grade_level);

-- ---------------------------------------------------------------------
-- 3. CLASSES
-- ---------------------------------------------------------------------
-- Teachers create only the classes they actually teach.
-- Each class stores its selected grade level (7 to 12).

create table if not exists public.classside_sections (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.classside_profiles(id) on delete cascade,
  grade_level integer not null check (grade_level between 7 and 12),
  name text not null,
  school_year text,
  color text not null default '#ff6b00',
  created_at timestamptz not null default now(),
  unique (teacher_id, grade_level, name)
);

create index if not exists classside_sections_teacher_idx
  on public.classside_sections(teacher_id);

create table if not exists public.classside_section_members (
  section_id uuid not null references public.classside_sections(id) on delete cascade,
  student_id uuid not null references public.classside_profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (section_id, student_id)
);

create index if not exists classside_members_student_idx
  on public.classside_section_members(student_id);

-- ---------------------------------------------------------------------
-- 4. USERNAME -> AUTH EMAIL ALIAS
-- ---------------------------------------------------------------------
-- Supabase Auth uses email/password. For generated student usernames,
-- the secure account-creation Edge Function can create a synthetic auth
-- email such as:
--   g9.santos.j@students.classside.invalid
-- and store that mapping here.
--
-- The frontend can call classside_resolve_login(username) before
-- signInWithPassword().

create table if not exists public.classside_login_aliases (
  username text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  auth_email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.classside_login_aliases enable row level security;
revoke all on public.classside_login_aliases from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. ASSIGNMENTS
-- ---------------------------------------------------------------------

create table if not exists public.classside_assignments (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.classside_sections(id) on delete cascade,
  teacher_id uuid not null references public.classside_profiles(id) on delete cascade,
  title text not null,
  instructions text,
  image_path text,
  due_at timestamptz,
  publish_at timestamptz,
  reminder_hours_before integer not null default 0
    check (reminder_hours_before in (0,24,48,72)),
  status text not null default 'published'
    check (status in ('draft','published','archived')),
  allow_resubmission boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists classside_assignments_section_due_idx
  on public.classside_assignments(section_id, due_at);

create index if not exists classside_assignments_teacher_idx
  on public.classside_assignments(teacher_id);

create index if not exists classside_assignments_publish_at_idx
  on public.classside_assignments(status, publish_at)
  where publish_at is not null;

-- ---------------------------------------------------------------------
-- 6. QUESTIONS
-- ---------------------------------------------------------------------
-- Correct answers are intentionally kept in a separate protected table
-- so students cannot download the answer key through the API.

create table if not exists public.classside_questions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.classside_assignments(id) on delete cascade,
  position integer not null check (position > 0),
  question_text text not null,
  question_type text not null default 'short'
    check (question_type in ('short','mcq')),
  options jsonb,
  max_points numeric(10,2) not null default 1 check (max_points >= 0),
  created_at timestamptz not null default now(),
  unique (assignment_id, position),
  check (
    (question_type = 'short' and options is null)
    or
    (question_type = 'mcq' and jsonb_typeof(options) = 'array')
  )
);

create index if not exists classside_questions_assignment_idx
  on public.classside_questions(assignment_id, position);

create table if not exists public.classside_question_keys (
  question_id uuid primary key references public.classside_questions(id) on delete cascade,
  correct_answer text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. SUBMISSIONS + ANSWERS
-- ---------------------------------------------------------------------

create table if not exists public.classside_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.classside_assignments(id) on delete cascade,
  student_id uuid not null references public.classside_profiles(id) on delete cascade,
  status text not null default 'submitted'
    check (status in ('submitted','graded','revision')),
  proof_path text,
  auto_score numeric(10,2) not null default 0 check (auto_score >= 0),
  teacher_score numeric(10,2),
  feedback text,
  attempt_count integer not null default 1 check (attempt_count >= 1),
  submitted_at timestamptz not null default now(),
  graded_at timestamptz,
  graded_by uuid references public.classside_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index if not exists classside_submissions_assignment_idx
  on public.classside_submissions(assignment_id);

create index if not exists classside_submissions_student_idx
  on public.classside_submissions(student_id);

create table if not exists public.classside_submission_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.classside_submissions(id) on delete cascade,
  question_id uuid not null references public.classside_questions(id) on delete cascade,
  answer_text text,
  is_correct boolean,
  awarded_points numeric(10,2) not null default 0 check (awarded_points >= 0),
  created_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create index if not exists classside_answers_submission_idx
  on public.classside_submission_answers(submission_id);

-- ---------------------------------------------------------------------
-- 8. GENERIC UPDATED_AT TRIGGER
-- ---------------------------------------------------------------------

create or replace function classside_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists classside_profiles_touch on public.classside_profiles;
create trigger classside_profiles_touch
before update on public.classside_profiles
for each row execute function classside_private.touch_updated_at();

drop trigger if exists classside_assignments_touch on public.classside_assignments;
create trigger classside_assignments_touch
before update on public.classside_assignments
for each row execute function classside_private.touch_updated_at();

drop trigger if exists classside_submissions_touch on public.classside_submissions;
create trigger classside_submissions_touch
before update on public.classside_submissions
for each row execute function classside_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- 9. PRIVATE SECURITY HELPERS
-- ---------------------------------------------------------------------

create or replace function classside_private.safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function classside_private.is_teacher(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.classside_profiles p
    where p.id = p_uid
      and p.role = 'teacher'
  );
$$;

create or replace function classside_private.is_student(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.classside_profiles p
    where p.id = p_uid
      and p.role = 'student'
  );
$$;

create or replace function classside_private.teacher_owns_section(
  p_section uuid,
  p_teacher uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.classside_sections s
    where s.id = p_section
      and s.teacher_id = p_teacher
  );
$$;

create or replace function classside_private.student_in_section(
  p_section uuid,
  p_student uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.classside_section_members m
    where m.section_id = p_section
      and m.student_id = p_student
  );
$$;

create or replace function classside_private.teacher_owns_assignment(
  p_assignment uuid,
  p_teacher uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.classside_assignments a
    where a.id = p_assignment
      and a.teacher_id = p_teacher
  );
$$;

create or replace function classside_private.teacher_can_view_student(
  p_student uuid,
  p_teacher uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.classside_section_members m
    join public.classside_sections s
      on s.id = m.section_id
    where m.student_id = p_student
      and s.teacher_id = p_teacher
  );
$$;

revoke all on all functions in schema classside_private from public, anon;
grant execute on all functions in schema classside_private to authenticated;
grant execute on function classside_private.safe_uuid(text) to anon;

-- ---------------------------------------------------------------------
-- 10. AUTH USER -> PROFILE TRIGGER + TEACHER APPROVAL
-- ---------------------------------------------------------------------
-- Public teacher signup flow:
--   1) Supabase Auth creates the user.
--   2) This trigger creates a EduCore profile with role = pending_teacher.
--   3) The account appears in Supabase Authentication immediately.
--   4) An administrator reviews the request and converts the profile role
--      from pending_teacher to teacher.
--
-- Student accounts are still created only by the secure create-students Edge
-- Function and use the internal @students.classside.invalid Auth domain.

create or replace function public.classside_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_subject text;
begin
  -- Student Auth users are created only by the secure Edge Function. The Edge
  -- Function creates the student EduCore profile explicitly after Auth user
  -- creation, so this trigger intentionally skips that internal domain.
  if lower(coalesce(new.email, '')) like '%@students.classside.invalid' then
    return new;
  end if;

  v_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name',''),
    split_part(new.email,'@',1),
    'Teacher'
  );

  v_subject := nullif(new.raw_user_meta_data->>'subject','');
  if v_subject not in ('English','Filipino','Araling Panlipunan','Science','ESP','TLE','MAPEH') then
    raise exception 'Choose a valid EduCore subject before creating a teacher account.';
  end if;

  insert into public.classside_profiles(
    id,
    display_name,
    role,
    subject,
    username,
    gender,
    grade_level,
    created_by_teacher
  )
  values (
    new.id,
    v_name,
    'pending_teacher',
    v_subject,
    null,
    null,
    null,
    null
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        subject = excluded.subject,
        role = case
          when public.classside_profiles.role = 'teacher' then 'teacher'
          else 'pending_teacher'
        end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_classside on auth.users;
create trigger on_auth_user_created_classside
after insert on auth.users
for each row execute function public.classside_handle_new_user();

revoke all on function public.classside_handle_new_user() from public, anon, authenticated;

-- Administrator-only helper. Run this from the Supabase SQL Editor (or with a
-- trusted service-role backend). It is intentionally NOT executable by normal
-- signed-in users, so a pending teacher cannot approve themself.
create or replace function public.classside_approve_teacher(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.classside_profiles
  set role = 'teacher',
      updated_at = now()
  where id = p_user_id
    and role = 'pending_teacher';

  if not found then
    raise exception 'Pending teacher request not found.';
  end if;
end;
$$;

revoke all on function public.classside_approve_teacher(uuid) from public, anon, authenticated;
grant execute on function public.classside_approve_teacher(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 11. USERNAME LOGIN RESOLVER
-- ---------------------------------------------------------------------
-- Frontend flow:
--   const { data: email } = await supabase.rpc(
--     'classside_resolve_login',
--     { p_username: login }
--   );
-- then signInWithPassword({ email, password })

create or replace function public.classside_resolve_login(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.auth_email
  from public.classside_login_aliases a
  where a.username = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.classside_resolve_login(text) from public;
grant execute on function public.classside_resolve_login(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 12. SECURE ASSIGNMENT SUBMISSION + AUTO-CHECK
-- ---------------------------------------------------------------------
-- p_answers JSON:
-- [
--   {"question_id":"UUID","answer":"5"},
--   {"question_id":"UUID","answer":"Option A"}
-- ]
--
-- Auto-check is exact text matching after trim/lowercase.
-- This is appropriate for MCQ and simple short answers.
-- More complex equivalent answers should still be manually reviewed.

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
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  if not classside_private.is_student(v_uid) then
    raise exception 'Only student accounts can submit assignments.';
  end if;

  select *
  into v_assignment
  from public.classside_assignments
  where id = p_assignment_id
    and status = 'published';

  if v_assignment.id is null then
    raise exception 'Assignment not found.';
  end if;

  if not classside_private.student_in_section(v_assignment.section_id, v_uid) then
    raise exception 'This assignment is not assigned to your section.';
  end if;

  select *
  into v_existing
  from public.classside_submissions
  where assignment_id = p_assignment_id
    and student_id = v_uid
  for update;

  if v_existing.id is not null then
    if not v_assignment.allow_resubmission then
      raise exception 'This assignment has already been submitted.';
    end if;

    v_submission_id := v_existing.id;
    v_attempt := v_existing.attempt_count + 1;

    delete from public.classside_submission_answers
    where submission_id = v_submission_id;

    update public.classside_submissions
    set
      status = 'submitted',
      proof_path = coalesce(p_proof_path, v_existing.proof_path),
      auto_score = 0,
      teacher_score = null,
      feedback = null,
      attempt_count = v_attempt,
      submitted_at = now(),
      graded_at = null,
      graded_by = null
    where id = v_submission_id;
  else
    insert into public.classside_submissions(
      assignment_id,
      student_id,
      proof_path,
      status
    )
    values(
      p_assignment_id,
      v_uid,
      p_proof_path,
      'submitted'
    )
    returning id into v_submission_id;
  end if;

  for v_answer in
    select value
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  loop
    select q.*
    into v_question
    from public.classside_questions q
    where q.id = classside_private.safe_uuid(v_answer->>'question_id')
      and q.assignment_id = p_assignment_id;

    if v_question.id is null then
      continue;
    end if;

    select k.correct_answer
    into v_key
    from public.classside_question_keys k
    where k.question_id = v_question.id;

    v_text := coalesce(v_answer->>'answer','');

    v_correct :=
      length(btrim(coalesce(v_key,''))) > 0
      and lower(btrim(v_text)) = lower(btrim(v_key));

    insert into public.classside_submission_answers(
      submission_id,
      question_id,
      answer_text,
      is_correct,
      awarded_points
    )
    values(
      v_submission_id,
      v_question.id,
      v_text,
      v_correct,
      case when v_correct then v_question.max_points else 0 end
    );

    if v_correct then
      v_auto_score := v_auto_score + v_question.max_points;
    end if;
  end loop;

  update public.classside_submissions
  set auto_score = v_auto_score
  where id = v_submission_id;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'auto_score', v_auto_score,
    'attempt_count', v_attempt
  );
end;
$$;

revoke all on function public.classside_submit_assignment(uuid,jsonb,text) from public, anon;
grant execute on function public.classside_submit_assignment(uuid,jsonb,text) to authenticated;

-- ---------------------------------------------------------------------
-- 13. TEACHER GRADING
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
  if v_uid is null or not classside_private.is_teacher(v_uid) then
    raise exception 'Only teachers can grade submissions.';
  end if;

  select *
  into v_submission
  from public.classside_submissions
  where id = p_submission_id
  for update;

  if v_submission.id is null then
    raise exception 'Submission not found.';
  end if;

  select *
  into v_assignment
  from public.classside_assignments
  where id = v_submission.assignment_id;

  if v_assignment.teacher_id <> v_uid then
    raise exception 'You do not own this assignment.';
  end if;

  select coalesce(sum(q.max_points), 0)
  into v_max_score
  from public.classside_questions q
  where q.assignment_id = v_assignment.id;

  if p_teacher_score is not null and p_teacher_score < 0 then
    raise exception 'Score cannot be negative.';
  end if;

  if p_teacher_score is not null and p_teacher_score > v_max_score then
    raise exception 'Score cannot exceed %.', v_max_score;
  end if;

  update public.classside_submissions
  set
    teacher_score = p_teacher_score,
    feedback = p_feedback,
    status = 'graded',
    graded_at = now(),
    graded_by = v_uid
  where id = p_submission_id;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'auto_score', v_submission.auto_score,
    'teacher_score', p_teacher_score
  );
end;
$$;

revoke all on function public.classside_grade_submission(uuid,numeric,text) from public, anon;
grant execute on function public.classside_grade_submission(uuid,numeric,text) to authenticated;

-- ---------------------------------------------------------------------
-- 14. RLS
-- ---------------------------------------------------------------------

alter table public.classside_profiles enable row level security;
alter table public.classside_sections enable row level security;
alter table public.classside_section_members enable row level security;
alter table public.classside_assignments enable row level security;
alter table public.classside_questions enable row level security;
alter table public.classside_question_keys enable row level security;
alter table public.classside_submissions enable row level security;
alter table public.classside_submission_answers enable row level security;

drop policy if exists classside_profiles_select on public.classside_profiles;
drop policy if exists classside_profiles_update_self on public.classside_profiles;

drop policy if exists classside_sections_select on public.classside_sections;
drop policy if exists classside_sections_insert_teacher on public.classside_sections;
drop policy if exists classside_sections_update_teacher on public.classside_sections;
drop policy if exists classside_sections_delete_teacher on public.classside_sections;

drop policy if exists classside_members_select on public.classside_section_members;

drop policy if exists classside_assignments_select on public.classside_assignments;
drop policy if exists classside_assignments_insert on public.classside_assignments;
drop policy if exists classside_assignments_update on public.classside_assignments;
drop policy if exists classside_assignments_delete on public.classside_assignments;

drop policy if exists classside_questions_select on public.classside_questions;
drop policy if exists classside_questions_insert on public.classside_questions;
drop policy if exists classside_questions_update on public.classside_questions;
drop policy if exists classside_questions_delete on public.classside_questions;

drop policy if exists classside_keys_teacher_all on public.classside_question_keys;

drop policy if exists classside_submissions_select on public.classside_submissions;
drop policy if exists classside_answers_select on public.classside_submission_answers;

-- PROFILES
create policy classside_profiles_select
on public.classside_profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (
    role = 'student'
    and classside_private.teacher_can_view_student(id, (select auth.uid()))
  )
);

create policy classside_profiles_update_self
on public.classside_profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- SECTIONS
create policy classside_sections_select
on public.classside_sections
for select
to authenticated
using (
  teacher_id = (select auth.uid())
  or classside_private.student_in_section(id, (select auth.uid()))
);

create policy classside_sections_insert_teacher
on public.classside_sections
for insert
to authenticated
with check (
  teacher_id = (select auth.uid())
  and classside_private.is_teacher((select auth.uid()))
);

create policy classside_sections_update_teacher
on public.classside_sections
for update
to authenticated
using (teacher_id = (select auth.uid()))
with check (teacher_id = (select auth.uid()));

create policy classside_sections_delete_teacher
on public.classside_sections
for delete
to authenticated
using (
  teacher_id = (select auth.uid())
  and classside_private.is_teacher((select auth.uid()))
);

-- MEMBERS
create policy classside_members_select
on public.classside_section_members
for select
to authenticated
using (
  student_id = (select auth.uid())
  or classside_private.teacher_owns_section(section_id, (select auth.uid()))
);

-- ASSIGNMENTS
create policy classside_assignments_select
on public.classside_assignments
for select
to authenticated
using (
  teacher_id = (select auth.uid())
  or (
    status = 'published'
    and classside_private.student_in_section(section_id, (select auth.uid()))
  )
);

create policy classside_assignments_insert
on public.classside_assignments
for insert
to authenticated
with check (
  teacher_id = (select auth.uid())
  and classside_private.is_teacher((select auth.uid()))
  and classside_private.teacher_owns_section(section_id, (select auth.uid()))
);

create policy classside_assignments_update
on public.classside_assignments
for update
to authenticated
using (teacher_id = (select auth.uid()))
with check (
  teacher_id = (select auth.uid())
  and classside_private.teacher_owns_section(section_id, (select auth.uid()))
);

create policy classside_assignments_delete
on public.classside_assignments
for delete
to authenticated
using (teacher_id = (select auth.uid()));

-- QUESTIONS
create policy classside_questions_select
on public.classside_questions
for select
to authenticated
using (
  exists (
    select 1
    from public.classside_assignments a
    where a.id = assignment_id
      and (
        a.teacher_id = (select auth.uid())
        or (
          a.status = 'published'
          and classside_private.student_in_section(
            a.section_id,
            (select auth.uid())
          )
        )
      )
  )
);

create policy classside_questions_insert
on public.classside_questions
for insert
to authenticated
with check (
  classside_private.teacher_owns_assignment(
    assignment_id,
    (select auth.uid())
  )
);

create policy classside_questions_update
on public.classside_questions
for update
to authenticated
using (
  classside_private.teacher_owns_assignment(
    assignment_id,
    (select auth.uid())
  )
)
with check (
  classside_private.teacher_owns_assignment(
    assignment_id,
    (select auth.uid())
  )
);

create policy classside_questions_delete
on public.classside_questions
for delete
to authenticated
using (
  classside_private.teacher_owns_assignment(
    assignment_id,
    (select auth.uid())
  )
);

-- ANSWER KEY: TEACHER ONLY
create policy classside_keys_teacher_all
on public.classside_question_keys
for all
to authenticated
using (
  exists (
    select 1
    from public.classside_questions q
    join public.classside_assignments a
      on a.id = q.assignment_id
    where q.id = question_id
      and a.teacher_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.classside_questions q
    join public.classside_assignments a
      on a.id = q.assignment_id
    where q.id = question_id
      and a.teacher_id = (select auth.uid())
  )
);

-- SUBMISSIONS
create policy classside_submissions_select
on public.classside_submissions
for select
to authenticated
using (
  student_id = (select auth.uid())
  or exists (
    select 1
    from public.classside_assignments a
    where a.id = assignment_id
      and a.teacher_id = (select auth.uid())
  )
);

-- ANSWERS
create policy classside_answers_select
on public.classside_submission_answers
for select
to authenticated
using (
  exists (
    select 1
    from public.classside_submissions s
    join public.classside_assignments a
      on a.id = s.assignment_id
    where s.id = submission_id
      and (
        s.student_id = (select auth.uid())
        or a.teacher_id = (select auth.uid())
      )
  )
);

-- ---------------------------------------------------------------------
-- 15. TABLE GRANTS
-- ---------------------------------------------------------------------
-- RLS still determines which rows are allowed.

grant select on
  public.classside_profiles,
  public.classside_sections,
  public.classside_section_members,
  public.classside_assignments,
  public.classside_questions,
  public.classside_submissions,
  public.classside_submission_answers
to authenticated;

grant select, insert, update, delete
on public.classside_assignments
to authenticated;

grant select, insert, update, delete
on public.classside_questions
to authenticated;

grant select, insert, update, delete
on public.classside_question_keys
to authenticated;

-- Only safe profile columns can be edited directly by a user.
revoke update on public.classside_profiles from authenticated;
grant update(display_name, avatar_path)
on public.classside_profiles
to authenticated;

grant select, insert, update, delete
on public.classside_sections
to authenticated;

-- The Edge Function uses an admin client. New Supabase projects no longer
-- auto-expose public tables, so grant the service role explicit table access.
grant select, insert, update, delete on
  public.classside_teacher_allowlist,
  public.classside_profiles,
  public.classside_sections,
  public.classside_section_members,
  public.classside_login_aliases,
  public.classside_assignments,
  public.classside_questions,
  public.classside_question_keys,
  public.classside_submissions,
  public.classside_submission_answers
to service_role;

-- Submissions/answers are written through secure RPCs.
revoke insert, update, delete
on public.classside_submissions
from authenticated;

revoke insert, update, delete
on public.classside_submission_answers
from authenticated;

-- ---------------------------------------------------------------------
-- 16. STORAGE BUCKETS
-- ---------------------------------------------------------------------

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
(
  'classside-assignment-images',
  'classside-assignment-images',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
),
(
  'classside-submission-proofs',
  'classside-submission-proofs',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
),
(
  'classside-avatars',
  'classside-avatars',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Remove old EduCore storage policies if this file is rerun.
drop policy if exists classside_assignment_image_upload on storage.objects;
drop policy if exists classside_assignment_image_read on storage.objects;
drop policy if exists classside_assignment_image_delete on storage.objects;

drop policy if exists classside_proof_upload on storage.objects;
drop policy if exists classside_proof_read on storage.objects;
drop policy if exists classside_proof_delete on storage.objects;

drop policy if exists classside_avatar_upload on storage.objects;
drop policy if exists classside_avatar_update on storage.objects;
drop policy if exists classside_avatar_read on storage.objects;
drop policy if exists classside_avatar_delete on storage.objects;

-- Assignment image path:
--   <teacher_uid>/<assignment_uuid>/<filename>

create policy classside_assignment_image_upload
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'classside-assignment-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and classside_private.is_teacher((select auth.uid()))
  and classside_private.teacher_owns_assignment(
    classside_private.safe_uuid((storage.foldername(name))[2]),
    (select auth.uid())
  )
);

create policy classside_assignment_image_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'classside-assignment-images'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.classside_assignments a
      where a.id = classside_private.safe_uuid((storage.foldername(name))[2])
        and (
          a.teacher_id = (select auth.uid())
          or classside_private.student_in_section(
            a.section_id,
            (select auth.uid())
          )
        )
    )
  )
);

create policy classside_assignment_image_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'classside-assignment-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and classside_private.is_teacher((select auth.uid()))
);

-- Student proof path:
--   <student_uid>/<assignment_uuid>/<filename>
-- The assignment UUID is known before the submit RPC runs.

create policy classside_proof_upload
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'classside-submission-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and classside_private.is_student((select auth.uid()))
);

create policy classside_proof_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'classside-submission-proofs'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.classside_assignments a
      where a.id = classside_private.safe_uuid(
        (storage.foldername(name))[2]
      )
        and a.teacher_id = (select auth.uid())
    )
  )
);

create policy classside_proof_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'classside-submission-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Avatar path:
--   <user_uid>/<filename>

create policy classside_avatar_upload
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'classside-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy classside_avatar_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'classside-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'classside-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy classside_avatar_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'classside-avatars'
);

create policy classside_avatar_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'classside-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- ---------------------------------------------------------------------
-- 17. POSTGREST RELOAD
-- ---------------------------------------------------------------------

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- AFTER RUNNING THIS FILE
-- =====================================================================
--
-- A) TEACHER REGISTRATION / ADMIN APPROVAL:
-- Teachers register normally in the EduCore website. Each new teacher is
-- created with role = pending_teacher and will appear under Authentication >
-- Users. To review pending requests:
--
-- select
--   p.id,
--   p.display_name,
--   u.email,
--   p.subject,
--   u.email_confirmed_at,
--   p.created_at
-- from public.classside_profiles p
-- join auth.users u on u.id = p.id
-- where p.role = 'pending_teacher'
-- order by p.created_at;
--
-- Approve one teacher by UID:
-- select public.classside_approve_teacher('PASTE-USER-UID-HERE'::uuid);
--
-- You can also use Table Editor > classside_profiles and change role from
-- pending_teacher to teacher. Normal authenticated users cannot change role.
--
-- B) AUTO-GENERATED STUDENT AUTH ACCOUNTS:
-- Deploy the included supabase/functions/create-students Edge Function.
-- It verifies the signed-in teacher, creates Auth users with an admin client,
-- and returns each temporary password to the teacher only once.
-- Never store a secret/service-role key in index.html, config.js or app.js.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SCHEDULED ASSIGNMENT PUBLISHING
-- ---------------------------------------------------------------------
alter table public.classside_assignments
  add column if not exists publish_at timestamptz;

create or replace function classside_private.publish_scheduled_assignments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  update public.classside_assignments
     set status = 'published', updated_at = now()
   where status = 'draft'
     and publish_at is not null
     and publish_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function classside_private.publish_scheduled_assignments() from public;
revoke all on function classside_private.publish_scheduled_assignments() from anon;
revoke all on function classside_private.publish_scheduled_assignments() from authenticated;
create extension if not exists pg_cron;
select cron.schedule(
  'classside-publish-scheduled-assignments',
  '* * * * *',
  $$select classside_private.publish_scheduled_assignments();$$
);
