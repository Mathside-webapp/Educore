create or replace function public.classside_set_teacher_performance_groups(
  p_assignment_id uuid,
  p_groups jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.classside_assignments;
  v_section_students uuid[] := '{}'::uuid[];
  v_seen uuid[] := '{}'::uuid[];
  v_group_members uuid[] := '{}'::uuid[];
  v_group_names text[] := '{}'::text[];
  v_group jsonb;
  v_member_text text;
  v_member uuid;
  v_leader uuid;
  v_group_id uuid;
  v_name text;
  v_total integer := 0;
  v_expected_groups integer := 0;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  select * into v_assignment from public.classside_assignments where id = p_assignment_id;
  if v_assignment.id is null then raise exception 'Performance task not found.'; end if;
  if v_assignment.teacher_id <> v_uid or not classside_private.is_teacher(v_uid) then
    raise exception 'Only the teacher can save performance groups.';
  end if;
  if coalesce(v_assignment.work_type, 'written_work') <> 'performance_task' then
    raise exception 'This is not a performance task.';
  end if;
  if coalesce(v_assignment.collaboration_mode, 'individual') = 'individual'
     or coalesce(v_assignment.grouping_creator, 'teacher') <> 'teacher' then
    raise exception 'Teacher-created pair or group mode is required.';
  end if;
  if jsonb_typeof(coalesce(p_groups, '[]'::jsonb)) <> 'array' then
    raise exception 'Groups must be an array.';
  end if;
  select coalesce(array_agg(sm.student_id order by sm.student_id), '{}'::uuid[]), count(*)
    into v_section_students, v_total
  from public.classside_section_members sm
  where sm.section_id = v_assignment.section_id;
  if v_total = 0 then
    delete from public.classside_performance_groups where assignment_id = p_assignment_id;
    return jsonb_build_object('groups', 0, 'students', 0);
  end if;
  if coalesce(v_assignment.collaboration_mode, 'individual') = 'pair' then
    v_expected_groups := ceil(v_total / 2.0)::integer;
  else
    v_expected_groups := greatest(1, least(v_total, coalesce(v_assignment.group_count, 1)));
  end if;
  if jsonb_array_length(p_groups) <> v_expected_groups then
    raise exception 'Expected % groups but received %.', v_expected_groups, jsonb_array_length(p_groups);
  end if;
  for v_group in select value from jsonb_array_elements(p_groups) loop
    v_name := nullif(btrim(v_group->>'name'), '');
    if v_name is null then raise exception 'Every group needs a name.'; end if;
    if v_name = any(v_group_names) then raise exception 'Duplicate group name: %.', v_name; end if;
    v_group_names := array_append(v_group_names, v_name);
    if jsonb_typeof(v_group->'member_ids') <> 'array' or jsonb_array_length(v_group->'member_ids') = 0 then
      raise exception '% must contain at least one learner.', v_name;
    end if;
    begin
      v_leader := nullif(v_group->>'leader_id', '')::uuid;
    exception when others then
      raise exception 'Invalid leader for %.', v_name;
    end;
    if v_leader is null then raise exception 'Choose a leader for %.', v_name; end if;
    v_group_members := '{}'::uuid[];
    for v_member_text in select value from jsonb_array_elements_text(v_group->'member_ids') loop
      begin
        v_member := v_member_text::uuid;
      exception when others then
        raise exception 'Invalid learner in %.', v_name;
      end;
      if not (v_member = any(v_section_students)) then raise exception 'A learner in % is no longer enrolled in this class.', v_name; end if;
      if v_member = any(v_seen) then raise exception 'A learner appears in more than one group.'; end if;
      v_seen := array_append(v_seen, v_member);
      v_group_members := array_append(v_group_members, v_member);
    end loop;
    if not (v_leader = any(v_group_members)) then raise exception 'The selected leader must belong to %.', v_name; end if;
  end loop;
  if cardinality(v_seen) <> v_total then raise exception 'Every enrolled learner must appear in exactly one group.'; end if;
  delete from public.classside_performance_groups where assignment_id = p_assignment_id;
  for v_group in select value from jsonb_array_elements(p_groups) loop
    v_name := btrim(v_group->>'name');
    v_leader := (v_group->>'leader_id')::uuid;
    insert into public.classside_performance_groups(assignment_id, section_id, name, created_by, leader_id)
    values(p_assignment_id, v_assignment.section_id, v_name, 'teacher', v_leader)
    returning id into v_group_id;
    for v_member_text in select value from jsonb_array_elements_text(v_group->'member_ids') loop
      v_member := v_member_text::uuid;
      insert into public.classside_performance_group_members(group_id, assignment_id, student_id, role)
      values(v_group_id, p_assignment_id, v_member, case when v_member = v_leader then 'leader' else 'member' end);
    end loop;
  end loop;
  return jsonb_build_object('groups', jsonb_array_length(p_groups), 'students', v_total);
end;
$$;
revoke all on function public.classside_set_teacher_performance_groups(uuid,jsonb) from public, anon;
grant execute on function public.classside_set_teacher_performance_groups(uuid,jsonb) to authenticated;
