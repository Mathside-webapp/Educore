-- =====================================================================
-- EduCore V23 - Storage Optimization
-- 1) Allow a teacher to delete submitted proof images for assignments they own.
-- 2) After a grade is saved, allow EduCore to clear the deleted proof paths
--    from the submission record so old/broken image links do not remain.
-- Run ONCE in Supabase SQL Editor after the existing EduCore migrations.
-- =====================================================================

begin;

-- Students may still delete their own uploaded proof files (used when replacing
-- an approved resubmission). Teachers may now delete proof files belonging to
-- submissions in assignments they own after reviewing/grading them.
drop policy if exists classside_proof_delete on storage.objects;
create policy classside_proof_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'classside-submission-proofs'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (
      classside_private.is_teacher((select auth.uid()))
      and classside_private.teacher_owns_assignment(
        classside_private.safe_uuid((storage.foldername(name))[2]),
        (select auth.uid())
      )
    )
  )
);

create or replace function public.classside_clear_submission_proofs(
  p_submission_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_submission public.classside_submissions;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select s.*
  into v_submission
  from public.classside_submissions s
  join public.classside_assignments a on a.id = s.assignment_id
  where s.id = p_submission_id
    and a.teacher_id = v_uid;

  if not found then
    raise exception 'Submission not found or you do not own this assignment.';
  end if;

  if v_submission.status <> 'graded' then
    raise exception 'Solution pictures can only be cleared after the submission is graded.';
  end if;

  update public.classside_submissions
  set proof_path = null,
      proof_paths = '[]'::jsonb,
      updated_at = now()
  where id = p_submission_id;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'proofs_cleared', true
  );
end;
$$;

revoke all on function public.classside_clear_submission_proofs(uuid) from public, anon;
grant execute on function public.classside_clear_submission_proofs(uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
