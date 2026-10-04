# EduCore V3.0 — Latest Mathside parity

Base: EduCore-Complete-V2.1.2-Student-Hero-Fix
Reference feature source: current Mathside (Progress-tracker-main(1) + V23 + V23.1 patches).

## Included
- Current Mathside workflow/UI improvements adapted to EduCore
- Written Works + Performance Tasks retained
- Performance task pair/group/team workflow and leader tools
- Multiple student solution/output images
- Manual per-answer review + teacher comments + controlled resubmission
- Archive/class reuse workflow
- PWA install/update/offline support
- Push notification support files
- Latest mobile/responsive activity-card behavior
- Browser image compression + graded-proof cleanup/storage optimization
- EduCore subject themes and teacher subject selection retained
- Math Keyboard and MathLive dependency intentionally excluded
- Easy temporary passwords: 4 lowercase pronounceable letters + 4 digits (example format: mapi4827)

## Existing project
Your existing js/config.js was preserved exactly.
For an existing EduCore V2.1 database, run the new SQL files in supabase/sql in numeric order starting at 06.
Deploy/update Edge Functions after copying the matching folders.

## Important
The new password format affects newly generated or newly reset student passwords. Existing student passwords are unchanged until reset.
