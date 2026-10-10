# EduCore V3.4 — Mathside V24.17 parity and updated text-free icon

EduCore V3.3 remains the starting point. Changes:

- Classic simple Create Class modal with grade/class name/reuse students, with responsive width correction.
- Destructive Delete buttons consistently RED with white text (not Archive/Unarchive).
- Reliable Web Push device activation (direct click gesture, iOS install help, bound account check, cached key, rate-limited registration).
- Less redundant notification polling (5 minutes) and student change checks (2 minutes), with retry cooldown.
- Teacher Calendar (Written Works + Performance Tasks). Student calendar retained.
- New text-free EduCore symbol applied to subject logos and PWA icons; the app name outside the icon remains.
- New service worker cache name so installed apps refresh.

Existing EduCore js/config.js, subject themes, SQL table names, teacher accounts, grading, and group work workflows are preserved.

## Publish
Upload these files to the EXISTING EduCore GitHub Pages repo. Do not upload to Mathside. If installed app shows old styling, close/reopen and reload twice for the new service worker.

## Notification backend
Optional file `sql/OPTIONAL-EDUCORE-PUSH-WEBHOOK-GUARD.sql` is included for reducing push webhook invocations where recipient has no registered device. It does not create or repair Web Push subscriptions. Do not run it if Supabase connection differs or the webhook was renamed. The website operates without it.

## Testing limitation
Static validation and mock interactions do not prove end-to-end Supabase writes, actual phone notifications, or student records; test with a teacher/student account before using in class.
