-- EduCore v21 — Teacher-selected leaders for teacher-created Performance Task teams.
-- Run once after 10-v19-performance-teamwork.sql.

create or replace function public.classside_set_performance_group_leaders(
  p_assignment_id uuid,
  p_leaders jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.classside_assignments;
  v_item jsonb;
  v_group_id uuid;
  v_group_name text;
  v_leader_id uuid;
  v_updated integer := 0;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  select * into v_assignment from public.classside_assignments where id = p_assignment_id;
  if v_assignment.id is null then raise exception 'Performance task not found.'; end if;
  if v_assignment.teacher_id <> v_uid or not classside_private.is_teacher(v_uid) then
    raise exception 'Only the teacher can choose team leaders.';
  end if;
  if coalesce(v_assignment.work_type,'written_work') <> 'performance_task' then
    raise exception 'This is not a performance task.';
  end if;
  if coalesce(v_assignment.grouping_creator,'teacher') <> 'teacher' then
    raise exception 'Leaders can be assigned here only for teacher-created teams.';
  end if;
  if jsonb_typeof(coalesce(p_leaders,'[]'::jsonb)) <> 'array' then
    raise exception 'Leader choices must be an array.';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_leaders,'[]'::jsonb)) loop
    v_group_name := nullif(trim(v_item->>'group_name'),'');
    begin
      v_leader_id := nullif(v_item->>'leader_id','')::uuid;
    exception when others then
      raise exception 'Invalid leader selection.';
    end;
    if v_group_name is null or v_leader_id is null then
      raise exception 'Every group needs a leader.';
    end if;

    select g.id into v_group_id
    from public.classside_performance_groups g
    where g.assignment_id = p_assignment_id and g.name = v_group_name
    limit 1;
    if v_group_id is null then raise exception 'Team % was not found.', v_group_name; end if;

    if not exists (
      select 1 from public.classside_performance_group_members gm
      where gm.group_id = v_group_id and gm.student_id = v_leader_id
    ) then
      raise exception 'The selected leader must belong to %.', v_group_name;
    end if;

    update public.classside_performance_group_members
      set role = case when student_id = v_leader_id then 'leader' else 'member' end
      where group_id = v_group_id;
    update public.classside_performance_groups
      set leader_id = v_leader_id
      where id = v_group_id;
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object('updated_groups',v_updated);
end;
$$;

grant execute on function public.classside_set_performance_group_leaders(uuid,jsonb) to authenticated;
