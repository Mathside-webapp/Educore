# EduCore V3.1.0 — Mathside V23.9 Parity Update

This build starts from **EduCore V3.0.5** and ports the current compatible Mathside improvements while keeping EduCore's multi-subject identity, subject-based colors/logos, and existing Supabase configuration.

## Included updates

- Reduced unnecessary Supabase reads:
  - lightweight student workspace change checks
  - longer full-refresh interval
  - cached signed URLs
  - cached submission answers
  - saving a grade updates local submission data instead of reloading the full teacher workspace
  - notification cache/poll optimizations
- Compact hidden filters:
  - Written Works: Section, Status, Order
  - Performance Tasks: Section, Status, Work setup (Individual / Pair / Group), Order
  - Submissions: Section, New / Checked, Separated / Combined, Newest / A–Z / Z–A
- Performance Task group logic:
  - pair/group tasks are identified correctly
  - group submissions show team type and leader
  - multi-section copies remain grouped as one logical task where appropriate
- Late submission labels restored in teacher and student views.
- Student image storage saver:
  - HEIC/HEIF conversion in the browser
  - student solution/output photos target about 450 KB with a ~500 KB safety ceiling
  - only the converted/compressed copy is uploaded
  - teacher task images keep the higher-quality compression setting
- Class Record Excel:
  - Total Score per student
  - Total Items
  - Total Possible Score
  - item/point information in task headers
  - Excel formulas recalculate Total Score if a score is edited manually
- Simpler temporary passwords:
  - 8 lowercase letters in an easy-to-type consonant/vowel pattern
  - applies to new student accounts and password resets
- Password-reset confirmation now uses an EduCore in-app popup instead of the browser's native confirm box.
- Existing manual review, controlled resubmission, archive features, subject themes, PWA behavior, and EduCore Supabase setup are retained.

## Important deployment step

For the simpler password format, redeploy both Edge Functions after uploading the website files:

- `supabase/functions/create-students/index.ts`
- `supabase/functions/reset-student-passwords/index.ts`

No new SQL migration is required for this V3.1 update.

## Intentionally excluded

Mathside's mathematics keyboard/equation-entry feature is **not** added to EduCore because EduCore is the general-subject version. Existing EduCore subject-specific branding is preserved.
