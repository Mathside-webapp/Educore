-- =====================================================================
-- EDUCORE V1.4 CLASSROOM WORKFLOW UPGRADE
-- Adds:
--   * Student To-Do List (uses existing assignments/submissions)
--   * Student Calendar (uses existing assignment due dates)
--   * Teacher Feedback Inbox (uses existing graded submissions)
--   * Student assignment draft saving
--   * Assignment resubmission controls (uses existing allow_resubmission)
--   * Notifications Center
--   * Export Class Record to Excel (frontend only)
--
-- Attendance and private messaging are intentionally NOT included.
-- No new Edge Function is required for these V10 features.
--
-- Run this ONCE after the existing EduCore V1.3.x database setup.
-- This script is idempotent and can be safely re-run.
-- =====================================================================

create extension if not exists pgcrypto;
create schema if not exists classside_private;

-- ---------------------------------------------------------------------
-- 0. CLEAN UP PRIVATE-MESSAGING OBJECTS FROM ANY EARLIER V10 TEST BUILD
-- ---------------------------------------------------------------------
-- These statements do nothing on a normal V9.x database. They make this
-- upgrade safe if an earlier preview of V10 with messaging was tested.
drop table if exists public.classside_messages cascade;
drop function if exists public.classside_message_contacts();
drop function if exists public.classside_send_message(uuid, text, uuid);
drop function if exists public.classside_get_conversation(uuid);
drop function if exists public.classside_mark_conversation_read(uuid);
drop function if exists classside_private.notify_private_message();
drop function if exists classside_private.can_message_users(uuid, uuid);

-- ---------------------------------------------------------------------
-- 1. STUDENT ASSIGNMENT DRAFTS
-- ---------------------------------------------------------------------
create table if not exists public.classside_assignment_drafts (
  student_id uuid not null references public.classside_profiles(id) on delete cascade,
  assignment_id uuid not null references public.classside_assignments(id) on delete cascade,
  answers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (student_id, assignment_id),
  check (jsonb_typeof(answers) = 'array')
);

create index if not exists classside_assignment_drafts_updated_idx
  on public.classside_assignment_drafts(student_id, updated_at desc);

alter table public.classside_assignment_drafts enable row level security;

drop policy if exists classside_drafts_select on public.classside_assignment_drafts;
drop policy if exists classside_drafts_insert on public.classside_assignment_drafts;
drop policy if exists classside_drafts_update on public.classside_assignment_drafts;
drop policy if exists classside_drafts_delete on public.classside_assignment_drafts;

create policy classside_drafts_select
on public.classside_assignment_drafts
for select
to authenticated
using (student_id = (select auth.uid()));

create policy classside_drafts_insert
on public.classside_assignment_drafts
for insert
to authenticated
with check (
  student_id = (select auth.uid())
  and classside_private.is_student((select auth.uid()))
  and exists (
    select 1
    from public.classside_assignments a
    where a.id = assignment_id
      and a.status = 'published'
      and classside_private.student_in_section(a.section_id, (select auth.uid()))
  )
);

create policy classside_drafts_update
on public.classside_assignment_drafts
for update
to authenticated
using (student_id = (select auth.uid()))
with check (
  student_id = (select auth.uid())
  and exists (
    select 1
    from public.classside_assignments a
    where a.id = assignment_id
      and a.status = 'published'
      and classside_private.student_in_section(a.section_id, (select auth.uid()))
  )
);

create policy classside_drafts_delete
on public.classside_assignment_drafts
for delete
to authenticated
using (student_id = (select auth.uid()));

grant select, insert, update, delete on public.classside_assignment_drafts to authenticated;

-- ---------------------------------------------------------------------
-- 2. NOTIFICATIONS CENTER
-- ---------------------------------------------------------------------
create table if not exists public.classside_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.classside_profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  related_assignment_id uuid references public.classside_assignments(id) on delete cascade,
  related_submission_id uuid references public.classside_submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- Remove columns/data that existed only in the abandoned messaging preview.
alter table public.classside_notifications drop column if exists related_message_id;
delete from public.classside_notifications where type = 'message';
alter table public.classside_notifications
  drop constraint if exists classside_notifications_type_check;
alter table public.classside_notifications
  add constraint classside_notifications_type_check
  check (type in ('assignment','submission','feedback','system'));

create index if not exists classside_notifications_user_created_idx
  on public.classside_notifications(user_id, created_at desc);
create index if not exists classside_notifications_user_unread_idx
  on public.classside_notifications(user_id, created_at desc)
  where read_at is null;

alter table public.classside_notifications enable row level security;

drop policy if exists classside_notifications_select on public.classside_notifications;
create policy classside_notifications_select
on public.classside_notifications
for select
to authenticated
using (user_id = (select auth.uid()));

grant select on public.classside_notifications to authenticated;

create or replace function public.classside_mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  update public.classside_notifications
  set read_at = coalesce(read_at, now())
  where user_id = v_uid
    and read_at is null
    and (p_ids is null or id = any(p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.classside_mark_notifications_read(uuid[]) from public;
grant execute on function public.classside_mark_notifications_read(uuid[]) to authenticated;

-- Assignment published -> notify students in that section.
create or replace function classside_private.notify_assignment_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'published' then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status <> 'published' or old.status = 'published' then
      return new;
    end if;
  end if;

  insert into public.classside_notifications(
    user_id, type, title, body, related_assignment_id
  )
  select
    m.student_id,
    'assignment',
    'New assignment',
    new.title || case when new.due_at is not null then ' · Due ' || to_char(new.due_at at time zone 'UTC', 'Mon DD') else '' end,
    new.id
  from public.classside_section_members m
  where m.section_id = new.section_id;

  return new;
end;
$$;

-- Student submission/resubmission -> teacher notification.
-- Teacher grade/feedback -> student notification.
create or replace function classside_private.notify_submission_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.classside_assignments;
  v_student_name text;
begin
  select * into v_assignment
  from public.classside_assignments
  where id = new.assignment_id;

  select p.display_name into v_student_name
  from public.classside_profiles p
  where p.id = new.student_id;

  if tg_op = 'INSERT' then
    insert into public.classside_notifications(
      user_id, type, title, body, related_assignment_id, related_submission_id
    ) values (
      v_assignment.teacher_id,
      'submission',
      'New submission',
      coalesce(v_student_name, 'A student') || ' submitted ' || coalesce(v_assignment.title, 'an assignment') || '.',
      new.assignment_id,
      new.id
    );
  elsif tg_op = 'UPDATE' then
    if new.attempt_count > old.attempt_count then
      insert into public.classside_notifications(
        user_id, type, title, body, related_assignment_id, related_submission_id
      ) values (
        v_assignment.teacher_id,
        'submission',
        'Assignment resubmitted',
        coalesce(v_student_name, 'A student') || ' sent attempt ' || new.attempt_count || ' for ' || coalesce(v_assignment.title, 'an assignment') || '.',
        new.assignment_id,
        new.id
      );
    end if;

    if new.status = 'graded'
       and (old.status is distinct from 'graded' or new.graded_at is distinct from old.graded_at) then
      insert into public.classside_notifications(
        user_id, type, title, body, related_assignment_id, related_submission_id
      ) values (
        new.student_id,
        'feedback',
        'New teacher feedback',
        coalesce(v_assignment.title, 'Your assignment') || ' has been reviewed.',
        new.assignment_id,
        new.id
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists classside_assignment_publish_notification on public.classside_assignments;
create trigger classside_assignment_publish_notification
after insert or update of status on public.classside_assignments
for each row execute function classside_private.notify_assignment_published();

drop trigger if exists classside_submission_notification on public.classside_submissions;
create trigger classside_submission_notification
after insert or update on public.classside_submissions
for each row execute function classside_private.notify_submission_change();

-- ---------------------------------------------------------------------
-- 3. CLEAN DRAFT AFTER SUCCESSFUL SUBMISSION / RESUBMISSION
-- ---------------------------------------------------------------------
create or replace function classside_private.clear_submitted_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.classside_assignment_drafts
  where student_id = new.student_id
    and assignment_id = new.assignment_id;
  return new;
end;
$$;

drop trigger if exists classside_submission_clear_draft on public.classside_submissions;
create trigger classside_submission_clear_draft
after insert or update of submitted_at on public.classside_submissions
for each row execute function classside_private.clear_submitted_draft();

-- ---------------------------------------------------------------------
-- 4. SECURITY CLEANUP
-- ---------------------------------------------------------------------
revoke all on function classside_private.notify_assignment_published() from public;
revoke all on function classside_private.notify_submission_change() from public;
revoke all on function classside_private.clear_submitted_draft() from public;

-- V10 upgrade complete.

-- =====================================================================
-- 7-DAY NOTIFICATION RETENTION
-- =====================================================================
-- EduCore V1.4 - 7-day notification retention
-- Run this ONCE after the V10 classroom features upgrade.
-- No Edge Function is required.

begin;

create index if not exists classside_notifications_created_at_idx
  on public.classside_notifications(created_at);

-- Authenticated clients call this once per browser session.  It deletes only
-- notifications that are already older than the seven-day retention period.
create or replace function public.classside_cleanup_old_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  delete from public.classside_notifications
  where created_at < now() - interval '7 days';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.classside_cleanup_old_notifications() from public;
grant execute on function public.classside_cleanup_old_notifications() to authenticated;

-- Database-side safety net: whenever EduCore creates a new notification,
-- expired notifications are also removed.  This keeps the table clean even
-- without relying only on the browser cleanup call.
create or replace function classside_private.cleanup_expired_notifications_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.classside_notifications
  where created_at < now() - interval '7 days';
  return null;
end;
$$;

drop trigger if exists classside_notification_retention_cleanup
  on public.classside_notifications;
create trigger classside_notification_retention_cleanup
before insert on public.classside_notifications
for each statement
execute function classside_private.cleanup_expired_notifications_on_insert();

-- Clean any rows that are already expired when this upgrade is installed.
delete from public.classside_notifications
where created_at < now() - interval '7 days';

commit;

