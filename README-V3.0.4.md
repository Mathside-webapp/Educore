# EduCore V3.0.4 — PWA Branding Fix

This build fixes the mobile/PWA branding inherited from Mathside.

## Fixed
- Replaced the Mathside e^x launcher icon with an EduCore icon.
- Added EduCore PNG logo variants for General, English, Filipino, Araling Panlipunan, Science, ESP, TLE, and MAPEH.
- The visible EduCore logo now follows the signed-in subject theme.
- Initial PWA theme color is EduCore indigo instead of Mathside orange.
- Android/browser theme color continues to follow the active subject after login.
- Offline page and PWA install/update dialogs no longer use Mathside orange styling.
- Added final overrides for notification, performance-task, calendar, and team-option orange residue.
- Bumped the service-worker cache and changed PWA icon filenames to reduce stale-icon caching.
- Technical Edge Function non-2xx errors are no longer shown verbatim to teachers.

## Important after deployment
An already-installed Android PWA may keep its old launcher icon because Android caches installed icons. After uploading this version and opening it once online, remove the old EduCore/Mathside home-screen app and install EduCore again. The new install will use the EduCore icon.

No SQL or Edge Function changes are required for these branding fixes. `js/config.js` is preserved unchanged.
