-- EduCore Step 6.9.7
-- Allow a teacher to reuse/enroll students from any class they own, active or archived.
-- Keeps the existing RPC name so older deployed clients stay compatible.

create or replace function public.classside_import_archived_students(
  p_source_section_id uuid,
  p_target_section_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_source public.classside_sections;
  v_target public.classside_sections;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if not classside_private.is_teacher(v_uid) then raise exception 'Only teachers can reuse class rosters.'; end if;

  select * into v_source from public.classside_sections where id = p_source_section_id;
  select * into v_target from public.classside_sections where id = p_target_section_id;
  if v_source.id is null or v_target.id is null then raise exception 'Class not found.'; end if;
  if v_source.teacher_id <> v_uid or v_target.teacher_id <> v_uid then raise exception 'You can only reuse students from your own classes.'; end if;
  if v_source.id = v_target.id then raise exception 'Choose a different source class.'; end if;
  if v_target.archived_at is not null then raise exception 'The target class is archived.'; end if;

  insert into public.classside_section_members(section_id,student_id)
  select p_target_section_id, m.student_id
  from public.classside_section_members m
  where m.section_id = p_source_section_id
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.classside_import_archived_students(uuid,uuid) from public, anon;
grant execute on function public.classside_import_archived_students(uuid,uuid) to authenticated;
