import { withSupabase } from 'npm:@supabase/server@1.8.0'

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

function validUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value)
}

function joinStoragePath(parent: string, child: string) {
  return parent ? `${parent.replace(/\/$/, '')}/${child}` : child
}

async function listFilesRecursive(storage: any, bucket: string, folder: string): Promise<string[]> {
  const paths: string[] = []
  const limit = 100
  let offset = 0

  while (true) {
    const { data, error } = await storage.from(bucket).list(folder, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) throw new Error(`Could not inspect ${bucket}: ${error.message}`)
    const items = data || []
    for (const item of items) {
      const path = joinStoragePath(folder, item.name)
      if (item.id == null) paths.push(...await listFilesRecursive(storage, bucket, path))
      else paths.push(path)
    }
    if (items.length < limit) break
    offset += limit
  }
  return paths
}

async function removePaths(storage: any, bucket: string, paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))]
  let deleted = 0
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const { data, error } = await storage.from(bucket).remove(chunk)
    if (error) throw new Error(`Could not delete files from ${bucket}: ${error.message}`)
    deleted += Array.isArray(data) ? data.length : chunk.length
  }
  return deleted
}

const deleteAssignment = withSupabase({ auth: 'user' }, async (req, ctx) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  try {
    const teacherId = String(ctx.userClaims?.id || '')
    if (!validUuid(teacherId)) return json({ error: 'You must be signed in.' }, 401)

    const { data: teacherProfile, error: teacherError } = await ctx.supabase
      .from('classside_profiles')
      .select('id,role')
      .eq('id', teacherId)
      .single()

    if (teacherError || teacherProfile?.role !== 'teacher') {
      return json({ error: 'Only teacher accounts can delete activities.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const assignmentId = String(body?.assignment_id || '')
    if (!validUuid(assignmentId)) return json({ error: 'A valid activity is required.' }, 400)

    const { data: assignment, error: assignmentError } = await ctx.supabase
      .from('classside_assignments')
      .select('id,teacher_id,section_id,title,image_path')
      .eq('id', assignmentId)
      .eq('teacher_id', teacherId)
      .single()

    if (assignmentError || !assignment) {
      return json({ error: 'Activity not found or you do not own it.' }, 404)
    }

    const { data: submissions, error: submissionsError } = await ctx.supabaseAdmin
      .from('classside_submissions')
      .select('student_id,proof_path')
      .eq('assignment_id', assignmentId)
    if (submissionsError) throw submissionsError

    const { data: members, error: membersError } = await ctx.supabaseAdmin
      .from('classside_section_members')
      .select('student_id')
      .eq('section_id', assignment.section_id)
    if (membersError) throw membersError

    const assignmentImagePaths = await listFilesRecursive(
      ctx.supabaseAdmin.storage,
      'classside-assignment-images',
      `${teacherId}/${assignmentId}`,
    )

    const studentIds = new Set<string>()
    for (const row of submissions || []) if (row.student_id) studentIds.add(String(row.student_id))
    for (const row of members || []) if (row.student_id) studentIds.add(String(row.student_id))

    const storedProofPaths: string[] = []
    for (const studentId of studentIds) {
      storedProofPaths.push(...await listFilesRecursive(
        ctx.supabaseAdmin.storage,
        'classside-submission-proofs',
        `${studentId}/${assignmentId}`,
      ))
    }

    const recordedProofPaths = (submissions || [])
      .map((row: any) => String(row.proof_path || ''))
      .filter(Boolean)

    const deletedAssignmentImages = await removePaths(
      ctx.supabaseAdmin.storage,
      'classside-assignment-images',
      [assignment.image_path ? String(assignment.image_path) : '', ...assignmentImagePaths],
    )

    const deletedProofFiles = await removePaths(
      ctx.supabaseAdmin.storage,
      'classside-submission-proofs',
      [...storedProofPaths, ...recordedProofPaths],
    )

    const { error: deleteError } = await ctx.supabaseAdmin
      .from('classside_assignments')
      .delete()
      .eq('id', assignmentId)
      .eq('teacher_id', teacherId)
    if (deleteError) throw deleteError

    return json({
      ok: true,
      assignment: { id: assignment.id, title: assignment.title },
      deleted_storage_files: deletedAssignmentImages + deletedProofFiles,
      deleted_assignment_images: deletedAssignmentImages,
      deleted_submission_files: deletedProofFiles,
    })
  } catch (error) {
    console.error('DELETE ASSIGNMENT ERROR', error)
    return json({ error: error instanceof Error ? error.message : 'Could not delete this activity.' }, 500)
  }
})

export default { fetch: deleteAssignment }
