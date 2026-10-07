-- EduCore V3.2 — delete own notifications
-- This migration is already applied to the connected EduCore Supabase project.

create or replace function public.classside_delete_notifications(
  p_ids uuid[] default null::uuid[]
)
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

  delete from public.classside_notifications
  where user_id = v_uid
    and (p_ids is null or id = any(p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.classside_delete_notifications(uuid[]) from public, anon;
grant execute on function public.classside_delete_notifications(uuid[]) to authenticated;
