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
    const { data, error } = await storage
      .from(bucket)
      .list(folder, {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })

    if (error) throw new Error(`Could not inspect ${bucket}: ${error.message}`)

    const items = data || []
    for (const item of items) {
      const path = joinStoragePath(folder, item.name)
      // Supabase folder entries have null file metadata/id. Recurse into them.
      if (item.id == null) {
        paths.push(...await listFilesRecursive(storage, bucket, path))
      } else {
        paths.push(path)
      }
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

const deleteStudent = withSupabase({ auth: 'user' }, async (req, ctx) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405)
  }

  try {
    const teacherId = String(ctx.userClaims?.id || '')
    if (!validUuid(teacherId)) {
      return json({ error: 'You must be signed in.' }, 401)
    }

    const { data: teacherProfile, error: teacherError } = await ctx.supabase
      .from('classside_profiles')
      .select('id,role')
      .eq('id', teacherId)
      .single()

    if (teacherError || teacherProfile?.role !== 'teacher') {
      return json({ error: 'Only teacher accounts can manage students.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const sectionId = String(body?.section_id || '')
    const studentId = String(body?.student_id || '')
    const deleteAccount = body?.delete_account === true

    if (!validUuid(sectionId) || !validUuid(studentId)) {
      return json({ error: 'A valid class and student are required.' }, 400)
    }

    const { data: section, error: sectionError } = await ctx.supabase
      .from('classside_sections')
      .select('id,teacher_id,name,grade_level')
      .eq('id', sectionId)
      .eq('teacher_id', teacherId)
      .single()

    if (sectionError || !section) {
      return json({ error: 'Class not found or you do not own it.' }, 403)
    }

    const { data: membership, error: membershipError } = await ctx.supabase
      .from('classside_section_members')
      .select('section_id,student_id')
      .eq('section_id', sectionId)
      .eq('student_id', studentId)
      .maybeSingle()

    if (membershipError) throw membershipError
    if (!membership) {
      return json({ error: 'This student is no longer in the selected class.' }, 404)
    }

    const { data: student, error: studentError } = await ctx.supabase
      .from('classside_profiles')
      .select('id,display_name,role,username,created_by_teacher,avatar_path')
      .eq('id', studentId)
      .single()

    if (studentError || !student || student.role !== 'student') {
      return json({ error: 'Student profile not found.' }, 404)
    }

    if (!deleteAccount) {
      const { error: removeError } = await ctx.supabaseAdmin
        .from('classside_section_members')
        .delete()
        .eq('section_id', sectionId)
        .eq('student_id', studentId)

      if (removeError) throw removeError

      return json({
        ok: true,
        action: 'removed_from_class',
        student: { id: student.id, name: student.display_name, username: student.username },
        section: { id: section.id, name: section.name, grade_level: section.grade_level },
      })
    }

    // Permanent Auth deletion is limited to the teacher who originally
    // created this Classside student account.
    if (String(student.created_by_teacher || '') !== teacherId) {
      return json({
        error: 'You can remove this student from your class, but only the teacher who created the account can permanently delete it.'
      }, 403)
    }

    // Gather every known student file BEFORE database/Auth cascades remove the
    // rows that contain file paths. We delete both database-recorded files and
    // anything left under the student's Storage folders, including orphaned
    // uploads from an interrupted/failed submission.
    const { data: submissions, error: submissionsError } = await ctx.supabaseAdmin
      .from('classside_submissions')
      .select('proof_path')
      .eq('student_id', studentId)

    if (submissionsError) throw submissionsError

    const recordedProofPaths = (submissions || [])
      .map((item: any) => String(item.proof_path || ''))
      .filter(Boolean)

    const storedProofPaths = await listFilesRecursive(
      ctx.supabaseAdmin.storage,
      'classside-submission-proofs',
      studentId,
    )

    const storedAvatarPaths = await listFilesRecursive(
      ctx.supabaseAdmin.storage,
      'classside-avatars',
      studentId,
    )

    const avatarPaths = [
      ...storedAvatarPaths,
      student.avatar_path ? String(student.avatar_path) : '',
    ].filter(Boolean)

    // Storage cleanup is REQUIRED for permanent deletion. If Storage cannot be
    // cleaned, stop here so the account is not removed while orphaned files
    // continue consuming the project's quota.
    const deletedProofFiles = await removePaths(
      ctx.supabaseAdmin.storage,
      'classside-submission-proofs',
      [...storedProofPaths, ...recordedProofPaths],
    )

    const deletedAvatarFiles = await removePaths(
      ctx.supabaseAdmin.storage,
      'classside-avatars',
      avatarPaths,
    )

    // Deleting the Auth user cascades through Classside profile, memberships,
    // submissions, submission answers, and username alias rows.
    const { error: deleteError } = await ctx.supabaseAdmin.auth.admin.deleteUser(studentId)
    if (deleteError) throw deleteError

    return json({
      ok: true,
      action: 'account_deleted',
      deleted_storage_files: deletedProofFiles + deletedAvatarFiles,
      deleted_submission_files: deletedProofFiles,
      deleted_avatar_files: deletedAvatarFiles,
      student: { id: student.id, name: student.display_name, username: student.username },
    })
  } catch (error) {
    console.error('DELETE STUDENT ERROR', error)
    return json({
      error: error instanceof Error ? error.message : 'Could not manage this student account.'
    }, 500)
  }
})

export default { fetch: deleteStudent }
