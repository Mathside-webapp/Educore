# EduCore

![EduCore under maintenance](assets/educore-maintenance.svg)

EduCore is a classroom workspace for non-Math subjects, with teacher and student views for classes, Written Works, Performance Tasks, submissions, feedback, records, notifications, and classroom organization.

## Under-maintenance fallback

The illustration above is also used by `offline.html`. When the live EduCore site cannot be reached, the service worker falls back to that page so users see a clear maintenance/unavailable screen instead of a broken page.

Keep these files together and do not rename the maintenance asset unless you also update its references:

- `README.md`
- `offline.html`
- `service-worker.js`
- `assets/educore-maintenance.svg`

## Important

Do not replace `js/config.js` with placeholder values. It contains the existing EduCore Supabase connection used by the deployed site.
