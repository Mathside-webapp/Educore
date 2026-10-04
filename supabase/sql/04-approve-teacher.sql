-- EduCore: approve one registered pending teacher by email.
-- Change only the email below, then run the entire file in Supabase SQL Editor.
do $$
declare
  v_email text := lower(trim('TEACHER_EMAIL@example.com'));
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email)=v_email limit 1;
  if v_uid is null then raise exception 'No Supabase Auth user found for %', v_email; end if;
  if lower(coalesce((select email from auth.users where id=v_uid),'')) like '%@students.classside.invalid' then
    raise exception 'This is a generated student account, not a teacher account.';
  end if;
  update public.classside_profiles
     set role='teacher', updated_at=now()
   where id=v_uid and role in ('pending_teacher','teacher');
  if not found then
    raise exception 'The user exists but does not have a pending teacher profile.';
  end if;
  raise notice 'Approved % as an EduCore teacher.', v_email;
end $$;
