import { withSupabase } from 'npm:@supabase/server@1.8.0'

function json(data: unknown, status = 200) {
  return Response.json(data, { status })
}

function validUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value)
}

function randomPassword() {
  const consonants = 'bcdfghjkmnpqrstvwxyz'
  const vowels = 'aeiu'
  const digits = '23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [
    consonants[bytes[0] % consonants.length],
    vowels[bytes[1] % vowels.length],
    consonants[bytes[2] % consonants.length],
    vowels[bytes[3] % vowels.length],
    digits[bytes[4] % digits.length],
    digits[bytes[5] % digits.length],
    digits[bytes[6] % digits.length],
    digits[bytes[7] % digits.length],
  ].join('')
}

const resetStudentPasswords = withSupabase({ auth: 'user' }, async (req, ctx) => {
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
      return json({ error: 'Only teacher accounts can reset student passwords.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const sectionId = String(body?.section_id || '')
    const studentIds = [...new Set(
      (Array.isArray(body?.student_ids) ? body.student_ids : [])
        .map((value: unknown) => String(value || ''))
        .filter(validUuid)
    )].slice(0, 60)

    if (!validUuid(sectionId) || !studentIds.length) {
      return json({ error: 'A valid class and at least one student are required.' }, 400)
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

    const { data: memberships, error: membershipError } = await ctx.supabase
      .from('classside_section_members')
      .select('student_id')
      .eq('section_id', sectionId)
      .in('student_id', studentIds)

    if (membershipError) throw membershipError
    const memberIds = new Set((memberships || []).map((item: any) => String(item.student_id || '')))

    const { data: profiles, error: profileError } = await ctx.supabase
      .from('classside_profiles')
      .select('id,display_name,role,username,gender,created_by_teacher')
      .in('id', studentIds)

    if (profileError) throw profileError
    const profileMap = new Map((profiles || []).map((profile: any) => [String(profile.id), profile]))

    const reset: Array<{ id: string; name: string; gender: string; username: string; temporary_password: string }> = []
    const failures: Array<{ id: string; name: string; error: string }> = []

    for (const studentId of studentIds) {
      const student: any = profileMap.get(studentId)
      const name = String(student?.display_name || 'Student')

      try {
        if (!memberIds.has(studentId)) {
          throw new Error('This student is no longer in the selected class.')
        }
        if (!student || student.role !== 'student') {
          throw new Error('Student profile not found.')
        }
        // Password changes affect the Auth account globally. Only the teacher
        // who originally generated the EduCore student account may reset it.
        if (String(student.created_by_teacher || '') !== teacherId) {
          throw new Error('Only the teacher who created this student account can reset its password.')
        }

        const temporaryPassword = randomPassword()
        const { error: updateError } = await ctx.supabaseAdmin.auth.admin.updateUserById(studentId, {
          password: temporaryPassword,
        })
        if (updateError) throw updateError

        reset.push({
          id: studentId,
          name,
          gender: String(student.gender || 'Not specified'),
          username: String(student.username || ''),
          temporary_password: temporaryPassword,
        })
      } catch (error) {
        failures.push({
          id: studentId,
          name,
          error: error instanceof Error ? error.message : 'Could not reset this password.',
        })
      }
    }

    return json({
      ok: failures.length === 0,
      section: { id: section.id, name: section.name, grade_level: section.grade_level },
      reset,
      failures,
    })
  } catch (error) {
    console.error('RESET STUDENT PASSWORDS ERROR', error)
    return json({
      error: error instanceof Error ? error.message : 'Could not reset student passwords.'
    }, 500)
  }
})

export default { fetch: resetStudentPasswords }
