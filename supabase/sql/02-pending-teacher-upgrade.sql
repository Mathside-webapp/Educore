-- =====================================================================
-- EDUCORE V1.1 — PENDING TEACHER APPROVAL UPGRADE
-- Run this ONCE in the same Supabase project where EduCore V1 is installed.
-- It removes the pre-signup allowlist requirement without deleting the old
-- allowlist table. Existing approved teachers remain teachers.
-- =====================================================================

begin;

-- 1) Allow pending_teacher as a profile role.
alter table public.classside_profiles
  drop constraint if exists classside_profiles_role_check;

alter table public.classside_profiles
  add constraint classside_profiles_role_check
  check (role in ('pending_teacher','teacher','student'));

-- 2) Public teacher registrations now create a pending profile instead of
--    requiring the email to be pre-added to classside_teacher_allowlist.
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
  -- Internal student Auth users are handled by create-students Edge Function.
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
    id, display_name, role, subject, username, gender, grade_level, created_by_teacher
  )
  values (
    new.id, v_name, 'pending_teacher', v_subject, null, null, null, null
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

-- 3) Administrator-only approval helper.
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

commit;
notify pgrst, 'reload schema';

-- =====================================================================
-- ADMIN WORKFLOW
-- =====================================================================
-- View pending teacher requests:
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
-- Approve by UID:
-- select public.classside_approve_teacher('PASTE-USER-UID-HERE'::uuid);
--
-- Or open Table Editor > classside_profiles and change role from
-- pending_teacher to teacher.
-- =====================================================================
