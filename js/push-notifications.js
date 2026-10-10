/* EduCore PWA Push Notifications — Step 6.9
   - Works only for authenticated users.
   - Uses the installed PWA service worker + Web Push.
   - VAPID public key is fetched securely from the authenticated Edge Function.
*/
(() => {
  'use strict';

  const FUNCTION_NAME = 'send-push-notification';
  const PROMPT_KEY = 'educore_push_prompt_dismissed_v1';
  const PUSH_SYNC_KEY = 'educore_push_last_sync_v2';
  const PUSH_BIND_KEY = 'educore_push_verified_device_v2';
  const PUSH_SYNC_TTL_MS = 12 * 60 * 60 * 1000;
  const PUSH_RETRY_MS = 5 * 60 * 1000;
  let nextSyncAttemptAt = 0;
  let cachedKeyPromise = null;
  let cachedRegistrationPromise = null;
  let lastUiUpdate = 0;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const sessionUser = () => (typeof state !== 'undefined' ? state.user : null) || null;
  const syncKey = userId => `${PUSH_SYNC_KEY}:${userId}`;
  const boundDevice = () => { try { return JSON.parse(localStorage.getItem(PUSH_BIND_KEY) || 'null'); } catch (_) { return null; } };
  let pushSyncPromise = null;
  let busy = false;
  let promptTimer = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const supported = () =>
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const currentUser = async () => {
    if (typeof db === 'undefined' || !db) return null;
    // This helper only needs the locally persisted session to decide whether the
    // UI should sync a push subscription. Authorization remains enforced by the
    // authenticated RPC itself, so avoid an extra Auth network request here.
    const { data } = await db.auth.getSession();
    return data?.session?.user || null;
  };

  const base64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  };

  async function getRegistration() {
    if (!supported()) throw new Error('Push notifications are not supported on this browser.');
    if (!cachedRegistrationPromise) cachedRegistrationPromise = navigator.serviceWorker.ready.catch(error => {
      cachedRegistrationPromise = null;
      throw error;
    });
    return cachedRegistrationPromise;
  }

  async function fetchVapidPublicKey() {
    if (cachedKeyPromise) return cachedKeyPromise;
    cachedKeyPromise = (async () => {
      if (typeof db === 'undefined' || !db) throw new Error('EduCore is not connected to Supabase.');
      const { data, error } = await db.functions.invoke(FUNCTION_NAME, { method: 'GET' });
      if (error) throw error;
      const key = String(data?.publicKey || '').trim();
      if (!key) throw new Error('Push notifications are not configured yet. Please contact your teacher.');
      return key;
    })().catch(error => { cachedKeyPromise = null; throw error; });
    return cachedKeyPromise;
  }

  async function saveSubscription(subscription) {
    const user = await currentUser();
    if (!user) throw new Error('Sign in before enabling app notifications.');
    const json = subscription.toJSON();
    const endpoint = String(json.endpoint || subscription.endpoint || '');
    const p256dh = String(json.keys?.p256dh || '');
    const auth = String(json.keys?.auth || '');
    if (!endpoint || !p256dh || !auth) throw new Error('The browser returned an incomplete push subscription.');

    const { error } = await db.rpc('classside_register_push_subscription', {
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent || null,
      p_platform: navigator.platform || null
    });
    if (error) throw error;
    // A browser subscription alone is insufficient: the device must be saved
    // for the CURRENT signed-in account in the database.
    localStorage.setItem(PUSH_BIND_KEY, JSON.stringify({ userId: user.id, endpoint, at: Date.now() }));
    localStorage.setItem(syncKey(user.id), String(Date.now()));
  }

  async function syncExistingSubscription({ force = false } = {}) {
    if (!supported() || Notification.permission !== 'granted' || !navigator.onLine) return false;
    const user = sessionUser() || await currentUser();
    if (!user) return false;
    if (pushSyncPromise) return pushSyncPromise;
    if (!force && Date.now() < nextSyncAttemptAt) return false;
    pushSyncPromise = (async () => {
      const registration = await getRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) { updateUi(); return false; }
      const verified = boundDevice();
      const lastSync = Number(localStorage.getItem(syncKey(user.id)) || 0);
      if (!force && verified?.userId === user.id && verified?.endpoint === subscription.endpoint &&
          lastSync && Date.now() - lastSync < PUSH_SYNC_TTL_MS) {
        updateUi();
        return true;
      }
      await saveSubscription(subscription);
      nextSyncAttemptAt = 0;
      updateUi();
      return true;
    })();
    try {
      return await pushSyncPromise;
    } catch (error) {
      nextSyncAttemptAt = Date.now() + PUSH_RETRY_MS;
      console.warn('EduCore app alert registration could not be refreshed:', error?.message || error);
      updateUi();
      return false;
    } finally {
      pushSyncPromise = null;
    }
  }

  async function enable({ quiet = false } = {}) {
    if (busy) return false;
    if (isIos() && !isStandalone()) {
      showInstallHelp();
      return false;
    }
    if (!supported()) {
      if (!quiet) showInstallHelp();
      return false;
    }
    // Keep permission request inside the user's click gesture. An awaited Auth
    // request before requestPermission() can make mobile browsers ignore it.
    if (!sessionUser()) {
      if (!quiet && typeof toast === 'function') toast('Sign in before enabling app alerts.', 'orange');
      return false;
    }
    busy = true;
    updateUi();
    try {
      let permission = Notification.permission;
      if (permission !== 'granted') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') throw new Error('Notifications are blocked. Allow EduCore notifications in your device/browser settings.');
        return false;
      }
      const registration = await getRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const publicKey = await fetchVapidPublicKey();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey)
        });
      }
      await saveSubscription(subscription);
      nextSyncAttemptAt = 0;
      localStorage.removeItem(PROMPT_KEY);
      if (!quiet && typeof toast === 'function') toast('This device is connected. You can receive EduCore alerts when the app is closed.', 'success', 'App alerts enabled');
      updateUi();
      return true;
    } catch (error) {
      console.error('EduCore push enable failed:', error);
      if (!quiet && typeof toast === 'function') toast(friendlyErrorMessage(error, 'Could not enable app notifications. Please retry.'), 'orange', 'App alerts');
      updateUi();
      return false;
    } finally {
      busy = false;
      updateUi();
    }
  }

  async function unregisterForCurrentUser({ unsubscribe = true } = {}) {
    if (!supported() || typeof db === 'undefined' || !db) return;
    try {
      const registration = await getRegistration();
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint || null;
      if (endpoint) {
        await db.rpc('classside_remove_push_subscription', { p_endpoint: endpoint });
        if (unsubscribe) await subscription.unsubscribe().catch(() => {});
      }
    } catch (error) {
      console.warn('EduCore push cleanup:', error);
    }
    const user = sessionUser();
    if (user?.id) localStorage.removeItem(syncKey(user.id));
    localStorage.removeItem(PUSH_BIND_KEY);
    updateUi();
  }

  async function disable() {
    if (busy) return;
    busy = true;
    updateUi();
    try {
      await unregisterForCurrentUser({ unsubscribe: true });
      localStorage.setItem(PROMPT_KEY, '1');
      if (typeof toast === 'function') toast('App notifications were turned off on this device.', 'success', 'Notifications off');
    } finally {
      busy = false;
      updateUi();
    }
  }

  async function status() {
    if (isIos() && !isStandalone()) return { supported: false, enabled: false, reason: 'ios-install' };
    if (!supported()) return { supported: false, enabled: false, reason: 'unsupported' };
    if (Notification.permission === 'denied') return { supported: true, enabled: false, reason: 'blocked' };
    if (Notification.permission !== 'granted') return { supported: true, enabled: false, reason: 'permission' };
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    const user = sessionUser();
    const bound = boundDevice();
    const registered = Boolean(user && subscription && bound?.userId === user.id && bound?.endpoint === subscription.endpoint);
    return {
      supported: true, enabled: registered, permission: Notification.permission,
      reason: registered ? 'connected' : (subscription ? 'not-registered' : 'not-subscribed'),
      standalone: isStandalone()
    };
  }

  function showInstallHelp() {
    ensurePromptDialog();
    const dialog = document.getElementById('educorePushPrompt');
    if (dialog && !dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
  }

  async function updateUi() {
    const button = document.getElementById('v10PushNotificationBtn');
    if (!button) return;
    try {
      const info = await status();
      button.hidden = false;
      button.disabled = busy;
      button.classList.toggle('push-enabled', info.enabled);
      const label = busy ? 'Connecting…' : (
        info.reason === 'connected' ? 'Device alerts on' :
        info.reason === 'ios-install' ? 'iPhone alert setup' :
        info.reason === 'unsupported' ? 'Alert help' :
        info.reason === 'blocked' ? 'Alerts blocked' : 'Enable device alerts');
      if (button.textContent !== label) button.textContent = label;
      button.title = info.enabled ? 'Turn off alerts on this device' : 'Set up notifications on this device';
      const hint = document.getElementById('v10PushStatus');
      if (hint) {
        const message = info.reason === 'connected'
          ? 'Device connected. New in-app updates also appear here.'
          : info.reason === 'ios-install'
          ? 'For iPhone/iPad: open EduCore in Safari, tap Share → Add to Home Screen, then enable alerts inside the installed app.'
          : info.reason === 'blocked'
          ? 'This browser has blocked alerts. Allow notifications for EduCore in device or browser settings.'
          : info.reason === 'unsupported'
          ? 'This browser cannot receive device alerts. EduCore updates are still available inside the app.'
          : info.reason === 'not-registered'
          ? 'This browser has a push subscription, but it is not yet linked to this EduCore account. Tap Enable device alerts.'
          : 'App updates appear here. Tap Enable device alerts to also receive phone or desktop alerts.';
        if (hint.textContent !== message) hint.textContent = message;
      }
    } catch (error) {
      if (button.textContent !== 'Enable device alerts') button.textContent = 'Enable device alerts';
      const hint = document.getElementById('v10PushStatus');
      if (hint) hint.textContent = 'Could not check device alert status. Please retry.';
    }
  }

  function ensurePromptDialog() {
    if (document.getElementById('educorePushPrompt')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'educorePushPrompt';
    dialog.className = 'pwa-dialog educore-push-dialog';
    dialog.innerHTML = `
      <div class="pwa-card educore-push-card">
        <div class="pwa-card-icon" aria-hidden="true">🔔</div>
        <div class="pwa-card-eyebrow">EDUCORE APP ALERTS</div>
        <h2>Get deadline and class notifications</h2>
        <p id="educorePushPromptInfo">Turn on alerts for activities, performance tasks, teacher feedback, and deadlines—even when EduCore is closed.</p>
        <div class="educore-push-note">You can turn these off anytime from the notification bell.</div>
        <div class="pwa-card-actions">
          <button type="button" class="pwa-btn pwa-btn-light" id="educorePushLaterBtn">Not now</button>
          <button type="button" class="pwa-btn pwa-btn-orange" id="educorePushEnableBtn">Turn on notifications</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    if (isIos() && !isStandalone()) {
      dialog.querySelector('#educorePushPromptInfo').textContent = 'On iPhone/iPad, open EduCore in Safari, tap Share → Add to Home Screen, open the installed app, sign in, and choose Enable device alerts.';
      dialog.querySelector('#educorePushEnableBtn').hidden = true;
    } else if (!supported()) {
      dialog.querySelector('#educorePushPromptInfo').textContent = 'This browser does not support Web Push. You can still read notifications by opening the EduCore bell.';
      dialog.querySelector('#educorePushEnableBtn').hidden = true;
    }
    dialog.querySelector('#educorePushLaterBtn')?.addEventListener('click', () => {
      localStorage.setItem(PROMPT_KEY, '1');
      dialog.close();
    });
    dialog.querySelector('#educorePushEnableBtn')?.addEventListener('click', async () => {
      const ok = await enable();
      if (ok) dialog.close();
    });
  }

  async function maybeOfferPush() {
    clearTimeout(promptTimer);
    promptTimer = setTimeout(async () => {
      try {
        if (!supported() || Notification.permission === 'denied') return;
        // Avoid interrupting iOS Safari before the Home Screen installation step.
        if (isIos() && !isStandalone()) return;
        if (localStorage.getItem(PROMPT_KEY) === '1') return;
        const user = await currentUser();
        if (!user) return;
        const info = await status();
        if (info.enabled) {
          await syncExistingSubscription().catch(() => {});
          return;
        }
        ensurePromptDialog();
        const dialog = document.getElementById('educorePushPrompt');
        if (dialog && !dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      } catch (error) {
        console.warn('EduCore push prompt:', error);
      }
    }, 1400);
  }

  async function handlePushOpen(detail = {}) {
    const notificationId = String(detail.notificationId || '');
    try {
      if (notificationId && typeof db !== 'undefined' && db) {
        await db.rpc('classside_mark_notifications_read', { p_ids: [notificationId] });
      }
      await window.EduCoreV10?.refreshNotifications?.({force:true});
      if (detail.type === 'feedback' && typeof showStudentPanel === 'function' && state?.profile?.role === 'student') {
        showStudentPanel('feedback');
      } else if (detail.relatedAssignmentId && state?.profile?.role === 'student') {
        showStudentPanel('todo');
      } else if (state?.profile?.role === 'teacher' && typeof showTeacherView === 'function') {
        showTeacherView('submissions');
      }
    } catch (error) {
      console.warn('EduCore push deep link:', error);
    }
  }

  function consumePushQuery() {
    const url = new URL(location.href);
    const notificationId = url.searchParams.get('push_notification');
    if (!notificationId) return;
    const detail = {
      notificationId,
      type: url.searchParams.get('push_type') || '',
      relatedAssignmentId: url.searchParams.get('assignment') || ''
    };
    url.searchParams.delete('push_notification');
    url.searchParams.delete('push_type');
    url.searchParams.delete('assignment');
    history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
    setTimeout(() => handlePushOpen(detail), 1800);
  }

  function bindNotificationButton() {
    const button = document.getElementById('v10PushNotificationBtn');
    if (!button || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      if ((isIos() && !isStandalone()) || !supported()) { showInstallHelp(); return; }
      const user = sessionUser();
      const bound = boundDevice();
      if (user && bound?.userId === user.id && Notification.permission === 'granted') {
        if (window.confirm('Turn off EduCore device alerts on this device?')) await disable();
      } else {
        // Activation must happen without an awaited status() beforehand.
        await enable();
      }
    });
    updateUi();
  }

  function injectStyles() {
    if (document.getElementById('educorePushStyles')) return;
    const style = document.createElement('style');
    style.id = 'educorePushStyles';
    style.textContent = `
      .v10-notification-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
      #v10PushNotificationBtn{border-color:color-mix(in srgb,var(--subject-primary,#4f46e5) 26%,white)!important;color:var(--subject-primary,#4f46e5)!important;background:var(--subject-soft,#f6f6ff)!important}
      #v10PushNotificationBtn.push-enabled{background:var(--subject-primary,#4f46e5)!important;border-color:var(--subject-primary,#4f46e5)!important;color:#fff!important}
      .educore-push-note{margin-top:14px;padding:11px 12px;border-radius:13px;background:var(--subject-soft,#f6f6ff);color:var(--subject-dark,#312e81);font-size:12px;line-height:1.45;border:1px solid color-mix(in srgb,var(--subject-primary,#4f46e5) 20%,white)}
      @media(max-width:620px){.v10-notification-title{align-items:flex-start!important}.v10-notification-actions{width:100%;justify-content:flex-start}.v10-notification-actions .btn{font-size:11px!important;padding:8px 10px!important}}
    `;
    document.head.appendChild(style);
  }

  const observer = new MutationObserver(() => bindNotificationButton());
  window.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    ensurePromptDialog();
    observer.observe(document.body, { childList: true, subtree: true });
    bindNotificationButton();
    consumePushQuery();
  });

  window.addEventListener('appinstalled', () => maybeOfferPush());
  window.addEventListener('focus', () => {
    updateUi();
    if (supported() && Notification.permission === 'granted') syncExistingSubscription().catch(() => {});
  });
  window.addEventListener('online', () => syncExistingSubscription().catch(() => {}));
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'EDUCORE_PUSH_OPEN') handlePushOpen(event.data);
  });

  if (typeof db !== 'undefined' && db) {
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        setTimeout(() => {
          syncExistingSubscription().catch(() => {});
          // Preload key only after sign-in; never request notification permission
          // except from a user's direct click.
          if (supported()) fetchVapidPublicKey().catch(() => {});
          maybeOfferPush();
          updateUi();
        }, 1000);
      }
      if (event === 'SIGNED_OUT') updateUi();
    });
  }

  window.EduCorePush = {
    enable,
    disable,
    status,
    syncExistingSubscription,
    unregisterForCurrentUser,
    maybeOfferPush
  };
})();
