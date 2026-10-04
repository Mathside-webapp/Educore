-- EduCore v22 — Student-created teams with teacher-selected leaders.
-- Run once after 10-v19-performance-teamwork.sql and 12-v21-performance-team-leader-choice.sql.

-- Students may form their own teams, but the creator is no longer automatically
-- made the leader. The teacher chooses the leader after the team is formed.
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
    if v_member = v_uid then raise exception 'You are already included in your team.'; end if;
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
  values(p_assignment_id,v_assignment.section_id,v_name,null,'students') returning id into v_group_id;

  insert into public.classside_performance_group_members(group_id,assignment_id,student_id,role)
  values(v_group_id,p_assignment_id,v_uid,'member');

  foreach v_member in array p_member_ids loop
    insert into public.classside_performance_group_members(group_id,assignment_id,student_id,role)
    values(v_group_id,p_assignment_id,v_member,'member');
  end loop;

  return jsonb_build_object('group_id',v_group_id,'name',v_name,'leader_id',null);
end;
$$;

-- Allow the teacher to select leaders for either teacher-created or
-- student-created teams. Accept group_id (preferred) or group_name.
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
  if jsonb_typeof(coalesce(p_leaders,'[]'::jsonb)) <> 'array' then
    raise exception 'Leader choices must be an array.';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_leaders,'[]'::jsonb)) loop
    v_group_id := null;
    v_group_name := nullif(trim(v_item->>'group_name'),'');
    begin
      if nullif(v_item->>'group_id','') is not null then
        v_group_id := (v_item->>'group_id')::uuid;
      end if;
      v_leader_id := nullif(v_item->>'leader_id','')::uuid;
    exception when others then
      raise exception 'Invalid team or leader selection.';
    end;

    if v_leader_id is null then raise exception 'Every selected team needs a leader.'; end if;

    if v_group_id is not null then
      select g.id, g.name into v_group_id, v_group_name
      from public.classside_performance_groups g
      where g.id = v_group_id and g.assignment_id = p_assignment_id
      limit 1;
    elsif v_group_name is not null then
      select g.id into v_group_id
      from public.classside_performance_groups g
      where g.assignment_id = p_assignment_id and g.name = v_group_name
      limit 1;
    else
      raise exception 'A team was not identified.';
    end if;

    if v_group_id is null then raise exception 'The selected team was not found.'; end if;

    if not exists (
      select 1 from public.classside_performance_group_members gm
      where gm.group_id = v_group_id and gm.student_id = v_leader_id
    ) then
      raise exception 'The selected leader must belong to %.', coalesce(v_group_name,'the team');
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

-- Teacher-only team roster for choosing leaders after students form teams.
create or replace function public.classside_get_performance_groups_for_teacher(
  p_assignment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.classside_assignments;
  v_groups jsonb;
  v_ungrouped jsonb;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  select * into v_assignment from public.classside_assignments where id = p_assignment_id;
  if v_assignment.id is null then raise exception 'Performance task not found.'; end if;
  if v_assignment.teacher_id <> v_uid or not classside_private.is_teacher(v_uid) then
    raise exception 'Only the teacher can view all teams.';
  end if;

  select coalesce(jsonb_agg(group_row order by group_row->>'name'),'[]'::jsonb)
    into v_groups
  from (
    select jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'leader_id', g.leader_id,
      'created_by', g.created_by,
      'members', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'display_name', p.display_name,
            'role', gm.role
          ) order by p.display_name, p.id
        )
        from public.classside_performance_group_members gm
        join public.classside_profiles p on p.id = gm.student_id
        where gm.group_id = g.id
      ),'[]'::jsonb)
    ) as group_row
    from public.classside_performance_groups g
    where g.assignment_id = p_assignment_id
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name
    ) order by p.display_name, p.id),'[]'::jsonb)
    into v_ungrouped
  from public.classside_section_members sm
  join public.classside_profiles p on p.id = sm.student_id
  where sm.section_id = v_assignment.section_id
    and not exists (
      select 1
      from public.classside_performance_group_members gm
      where gm.assignment_id = p_assignment_id and gm.student_id = sm.student_id
    );

  return jsonb_build_object(
    'groups', coalesce(v_groups,'[]'::jsonb),
    'ungrouped', coalesce(v_ungrouped,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.classside_create_student_performance_team(uuid,uuid[]) from public, anon;
revoke all on function public.classside_set_performance_group_leaders(uuid,jsonb) from public, anon;
revoke all on function public.classside_get_performance_groups_for_teacher(uuid) from public, anon;

grant execute on function public.classside_create_student_performance_team(uuid,uuid[]) to authenticated;
grant execute on function public.classside_set_performance_group_leaders(uuid,jsonb) to authenticated;
grant execute on function public.classside_get_performance_groups_for_teacher(uuid) to authenticated;
