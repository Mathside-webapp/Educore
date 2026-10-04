-- =====================================================================
-- EduCore V16 - Installed PWA Push Notifications + Deadline Reminders
-- Run ONCE after 06-v15-performance-multiple-files.sql
-- =====================================================================

begin;

create table if not exists public.classside_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classside_push_endpoint_unique unique(endpoint)
);

create index if not exists classside_push_subscriptions_user_idx
  on public.classside_push_subscriptions(user_id, updated_at desc);

alter table public.classside_push_subscriptions enable row level security;

-- The browser never queries this table directly. Registration/removal is done
-- through tightly scoped authenticated RPCs; the Edge Function uses service_role.
revoke all on public.classside_push_subscriptions from anon, authenticated;
grant all on public.classside_push_subscriptions to service_role;

create or replace function public.classside_register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null,
  p_platform text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if nullif(btrim(coalesce(p_endpoint,'')),'') is null
     or nullif(btrim(coalesce(p_p256dh,'')),'') is null
     or nullif(btrim(coalesce(p_auth,'')),'') is null then
    raise exception 'Invalid push subscription.';
  end if;

  -- A browser push endpoint belongs to only one currently signed-in EduCore user.
  delete from public.classside_push_subscriptions
  where endpoint = p_endpoint and user_id <> v_uid;

  insert into public.classside_push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,platform)
  values(v_uid,p_endpoint,p_p256dh,p_auth,p_user_agent,p_platform)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        platform = excluded.platform,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.classside_register_push_subscription(text,text,text,text,text) from public, anon;
grant execute on function public.classside_register_push_subscription(text,text,text,text,text) to authenticated;

create or replace function public.classside_remove_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then return false; end if;
  delete from public.classside_push_subscriptions
  where user_id = v_uid and endpoint = p_endpoint;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.classside_remove_push_subscription(text) from public, anon;
grant execute on function public.classside_remove_push_subscription(text) to authenticated;

-- One-time deadline-reminder log prevents duplicate reminders when the Cron job runs repeatedly.
create table if not exists public.classside_deadline_reminder_log (
  assignment_id uuid not null references public.classside_assignments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  due_at timestamptz not null,
  reminder_hours integer not null,
  sent_at timestamptz not null default now(),
  primary key (assignment_id, student_id, due_at, reminder_hours)
);

alter table public.classside_deadline_reminder_log enable row level security;
revoke all on public.classside_deadline_reminder_log from anon, authenticated;
grant all on public.classside_deadline_reminder_log to service_role;

create or replace function classside_private.enqueue_deadline_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  with candidates as (
    select
      a.id as assignment_id,
      m.student_id,
      a.title,
      a.work_type,
      a.due_at,
      a.reminder_hours_before
    from public.classside_assignments a
    join public.classside_section_members m on m.section_id = a.section_id
    left join public.classside_submissions s
      on s.assignment_id = a.id and s.student_id = m.student_id
    where a.status = 'published'
      and a.due_at is not null
      and coalesce(a.reminder_hours_before,0) in (24,48,72)
      and now() >= a.due_at - make_interval(hours => a.reminder_hours_before)
      and now() < a.due_at
      and s.id is null
  ), inserted_log as (
    insert into public.classside_deadline_reminder_log(assignment_id,student_id,due_at,reminder_hours)
    select assignment_id,student_id,due_at,reminder_hours_before
    from candidates
    on conflict do nothing
    returning assignment_id,student_id,due_at,reminder_hours
  ), pushed as (
    insert into public.classside_notifications(user_id,type,title,body,related_assignment_id)
    select
      c.student_id,
      'assignment',
      case when c.work_type='performance_task' then 'Performance task deadline' else 'Activity deadline' end,
      c.title || ' · Due ' || to_char(c.due_at at time zone 'Asia/Manila','Mon DD, HH12:MI AM'),
      c.assignment_id
    from candidates c
    join inserted_log l
      on l.assignment_id=c.assignment_id
     and l.student_id=c.student_id
     and l.due_at=c.due_at
     and l.reminder_hours=c.reminder_hours_before
    returning 1
  )
  select count(*) into v_count from pushed;

  return v_count;
end;
$$;

revoke all on function classside_private.enqueue_deadline_reminders() from public, anon, authenticated;
grant execute on function classside_private.enqueue_deadline_reminders() to service_role, postgres;

commit;

-- Enable Supabase Cron and run the reminder scanner every 15 minutes.
-- Running the same named schedule again updates/replaces that job.
create extension if not exists pg_cron;
select cron.schedule(
  'classside-deadline-reminders',
  '*/15 * * * *',
  'select classside_private.enqueue_deadline_reminders();'
);

notify pgrst, 'reload schema';
