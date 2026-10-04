/* EduCore PWA — V3.0.4
   GitHub Pages + localhost friendly.
   Provides app-shell caching, a graceful offline fallback, and controlled updates. */

const CACHE_NAME = 'educore-pwa-v3.0.4';
const CACHE_PREFIX = 'educore-pwa-';

const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './icons/educore-apple-touch-icon.png?v=304',
  './icons/educore-icon-192.png',
  './icons/educore-icon-512.png',
  './icons/educore-maskable-512.png',
  './assets/educore-logos/educore-general.png?v=304',
  './assets/educore-logos/educore-english.png?v=304',
  './assets/educore-logos/educore-filipino.png?v=304',
  './assets/educore-logos/educore-araling-panlipunan.png?v=304',
  './assets/educore-logos/educore-science.png?v=304',
  './assets/educore-logos/educore-esp.png?v=304',
  './assets/educore-logos/educore-tle.png?v=304',
  './assets/educore-logos/educore-mapeh.png?v=304',
  './css/styles.css?v=12.2',
  './css/art-theme.css?v=7.0',
  './css/student-v8.css?v=10.5',
  './css/design-v9.css?v=9.1',
  './css/classroom-features.css?v=11.3',
  './js/config.js',
  './js/app.js?v=15.7',
  './js/student-v8.js?v=15.0',
  './js/classroom-features.js?v=15.1',
  './js/design-v9.js?v=9',
  './js/pwa.js?v=6.9.16',
  './js/push-notifications.js?v=6.9.1',
  './css/archive-features.css?v=12.2',
  './css/layout-fixes.css?v=14.0',
  './css/work-types-v21.css?v=15.10',
  './css/subject-themes.css?v=3.0.4',
  './js/archive-features.js?v=15.3',
  './js/work-types-v21.js?v=15.7'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase/CDN/other third-party requests stay network-controlled.
  if (url.origin !== self.location.origin) return;

  // Page navigations: try the newest version first, then cached page, then offline screen.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, fresh.clone());
        }
        return fresh;
      } catch (_) {
        return (await caches.match(request))
          || (await caches.match('./index.html'))
          || (await caches.match('./offline.html'));
      }
    })());
    return;
  }

  // Same-origin assets: network first so CSS/JS edits appear quickly, cache as fallback.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch (_) {
      return (await caches.match(request)) || Response.error();
    }
  })());
});


// ---------------------------------------------------------------------------
// Step 6.9.3: Web Push notifications + final mobile roster polish.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch (_) {
      payload = { body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'EduCore';
    const data = {
      notificationId: payload.notificationId || '',
      type: payload.type || 'update',
      relatedAssignmentId: payload.relatedAssignmentId || '',
      relatedSubmissionId: payload.relatedSubmissionId || '',
      url: payload.url || './'
    };

    await self.registration.showNotification(title, {
      body: payload.body || 'You have a new EduCore update.',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: payload.tag || `classside-${data.notificationId || Date.now()}`,
      renotify: false,
      data,
      actions: [{ action: 'open', title: 'Open EduCore' }]
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const params = new URLSearchParams();
    if (data.notificationId) params.set('push_notification', data.notificationId);
    if (data.type) params.set('push_type', data.type);
    if (data.relatedAssignmentId) params.set('assignment', data.relatedAssignmentId);
    const target = `./${params.toString() ? `?${params.toString()}` : ''}`;

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => {
      try { return new URL(client.url).origin === self.location.origin; } catch (_) { return false; }
    });
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'EDUCORE_PUSH_OPEN', ...data });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
