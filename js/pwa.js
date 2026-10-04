(() => {
  if (!('serviceWorker' in navigator)) return;

  let registrationRef = null;
  let reloadingForUpdate = false;
  let deferredInstallPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIos = () => {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iphone|ipad|ipod/i.test(ua)
      || (platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  };

  const isAndroid = () => /android/i.test(navigator.userAgent || '');

  const isSamsungBrowser = () => /SamsungBrowser/i.test(navigator.userAgent || '');

  const isSafari = () => {
    const ua = navigator.userAgent || '';
    return /safari/i.test(ua)
      && !/crios|fxios|edgios|opios|duckduckgo/i.test(ua);
  };

  function ensurePwaUi() {
    if (!document.getElementById('pwaOfflineBanner')) {
      const banner = document.createElement('div');
      banner.id = 'pwaOfflineBanner';
      banner.setAttribute('role', 'status');
      banner.innerHTML = '<strong>You are offline.</strong><span> Some EduCore features need an internet connection.</span>';
      Object.assign(banner.style, {
        position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)',
        zIndex: '100000', maxWidth: 'calc(100% - 28px)', padding: '11px 16px',
        borderRadius: '14px', background: '#2f241d', color: '#fff',
        boxShadow: '0 14px 34px rgba(47,36,29,.24)',
        font: '600 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        display: 'none', textAlign: 'center'
      });
      document.body.appendChild(banner);
    }

    if (!document.getElementById('pwaUpdateDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'pwaUpdateDialog';
      dialog.setAttribute('aria-labelledby', 'pwaUpdateTitle');
      dialog.innerHTML = `
        <div class="pwa-card">
          <div class="pwa-card-icon">↻</div>
          <div class="pwa-card-eyebrow">EDUCORE UPDATE</div>
          <h2 id="pwaUpdateTitle">A new version is ready</h2>
          <p>Update now to load the latest EduCore changes. Your account and Supabase data will not be removed.</p>
          <div class="pwa-card-actions">
            <button id="pwaUpdateLaterBtn" type="button" class="pwa-btn pwa-btn-light">Later</button>
            <button id="pwaUpdateNowBtn" type="button" class="pwa-btn pwa-btn-orange">Update now</button>
          </div>
        </div>`;
      dialog.className = 'pwa-dialog';
      document.body.appendChild(dialog);

      dialog.querySelector('#pwaUpdateLaterBtn').addEventListener('click', () => dialog.close());

      const updateNowBtn = dialog.querySelector('#pwaUpdateNowBtn');
      updateNowBtn.addEventListener('click', async () => {
        // Mobile browsers/PWAs can take a moment to hand control from the old
        // service worker to the waiting one. Give immediate feedback, ask the
        // waiting worker to activate, and keep a reload fallback so the button
        // never appears to do nothing.
        if (updateNowBtn.dataset.updating === '1') return;
        updateNowBtn.dataset.updating = '1';
        updateNowBtn.disabled = true;
        updateNowBtn.setAttribute('aria-busy', 'true');
        updateNowBtn.textContent = 'Updating…';

        const reloadFallback = window.setTimeout(() => {
          if (reloadingForUpdate) return;
          reloadingForUpdate = true;
          location.reload();
        }, 2200);

        try {
          let registration = registrationRef;
          if (!registration) registration = await navigator.serviceWorker.getRegistration('./');

          // Re-check the server first. On some Android browsers registration.waiting
          // is populated only after update() has completed.
          if (registration) {
            try { await registration.update(); } catch (_) {}
          }

          const waiting = registration && registration.waiting;
          if (waiting) {
            waiting.postMessage({ type: 'SKIP_WAITING' });

            // If the worker reaches activated before controllerchange is emitted,
            // reload immediately. controllerchange below remains the primary path.
            waiting.addEventListener('statechange', () => {
              if (waiting.state !== 'activated' || reloadingForUpdate) return;
              clearTimeout(reloadFallback);
              reloadingForUpdate = true;
              location.reload();
            });
            return;
          }

          // No separate waiting worker (common when the browser already activated
          // it in the background). Reload so the newest HTML/CSS/JS is requested.
          clearTimeout(reloadFallback);
          reloadingForUpdate = true;
          location.reload();
        } catch (error) {
          console.error('EduCore update failed:', error);
          clearTimeout(reloadFallback);
          updateNowBtn.dataset.updating = '0';
          updateNowBtn.disabled = false;
          updateNowBtn.removeAttribute('aria-busy');
          updateNowBtn.textContent = 'Try update again';
        }
      });
    }

    if (!document.getElementById('pwaIosInstallDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'pwaIosInstallDialog';
      dialog.className = 'pwa-dialog';
      dialog.setAttribute('aria-labelledby', 'pwaIosInstallTitle');
      dialog.innerHTML = `
        <div class="pwa-card pwa-ios-card">
          <div class="pwa-card-icon pwa-share-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 15V3m0 0L8 7m4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="pwa-card-eyebrow">INSTALL EDUCORE ON IPHONE</div>
          <h2 id="pwaIosInstallTitle">Add EduCore like an app</h2>
          <p id="pwaIosInstallIntro" class="pwa-ios-intro">
            Apple requires Home Screen web apps to be added from Safari's Share menu.
          </p>

          <div class="pwa-ios-step-list">
            <div class="pwa-ios-step">
              <span class="pwa-ios-step-number">1</span>
              <div><strong>Tap Share</strong><span>Tap the square-with-arrow Share button in Safari.</span></div>
            </div>
            <div class="pwa-ios-step">
              <span class="pwa-ios-step-number">2</span>
              <div><strong>Add to Home Screen</strong><span>Scroll the Share menu and choose <em>Add to Home Screen</em>.</span></div>
            </div>
            <div class="pwa-ios-step">
              <span class="pwa-ios-step-number">3</span>
              <div><strong>Open as Web App</strong><span>If shown, keep <em>Open as Web App</em> enabled, then tap <em>Add</em>.</span></div>
            </div>
          </div>

          <div class="pwa-ios-result">
            <span class="pwa-ios-result-icon">✓</span>
            <span>EduCore will appear on your Home Screen and open without Safari's address bar.</span>
          </div>

          <div class="pwa-card-actions">
            <button id="pwaIosCopyLinkBtn" type="button" class="pwa-btn pwa-btn-light" hidden>Copy link</button>
            <button id="pwaIosInstallCloseBtn" type="button" class="pwa-btn pwa-btn-orange">Got it</button>
          </div>
        </div>`;
      document.body.appendChild(dialog);

      const copyBtn = dialog.querySelector('#pwaIosCopyLinkBtn');
      const intro = dialog.querySelector('#pwaIosInstallIntro');
      if (!isSafari()) {
        intro.innerHTML = '<strong>First open this EduCore page in Safari.</strong> Then follow the three steps below.';
        copyBtn.hidden = false;
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(location.href);
            copyBtn.textContent = 'Link copied';
            setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1800);
          } catch (_) {
            window.prompt('Copy this EduCore link, then open it in Safari:', location.href);
          }
        });
      }

      dialog.querySelector('#pwaIosInstallCloseBtn').addEventListener('click', () => dialog.close());
    }

    if (!document.getElementById('pwaAndroidInstallDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'pwaAndroidInstallDialog';
      dialog.className = 'pwa-dialog';
      dialog.setAttribute('aria-labelledby', 'pwaAndroidInstallTitle');
      const samsung = isSamsungBrowser();
      dialog.innerHTML = `
        <div class="pwa-card pwa-ios-card">
          <div class="pwa-card-icon" aria-hidden="true">⇩</div>
          <div class="pwa-card-eyebrow">INSTALL EDUCORE ON ANDROID</div>
          <h2 id="pwaAndroidInstallTitle">Add EduCore like an app</h2>
          <p class="pwa-ios-intro">EduCore detected an Android device. Follow these steps if the browser does not show its install prompt automatically.</p>
          <div class="pwa-ios-step-list">
            <div class="pwa-ios-step"><span class="pwa-ios-step-number">1</span><div><strong>Open the browser menu</strong><span>${samsung ? 'Tap the browser menu button.' : 'Tap the three-dot menu ⋮ in your browser.'}</span></div></div>
            <div class="pwa-ios-step"><span class="pwa-ios-step-number">2</span><div><strong>${samsung ? 'Add page to Home screen' : 'Choose Install app'}</strong><span>${samsung ? 'Choose Add page to, then Home screen.' : 'Choose Install app or Add to Home screen.'}</span></div></div>
            <div class="pwa-ios-step"><span class="pwa-ios-step-number">3</span><div><strong>Confirm</strong><span>Tap Install or Add. EduCore will appear with your other apps.</span></div></div>
          </div>
          <div class="pwa-ios-result"><span class="pwa-ios-result-icon">✓</span><span>After installation, open EduCore from your Home screen for the app-style experience.</span></div>
          <div class="pwa-card-actions">
            <button id="pwaAndroidGuideCloseBtn" type="button" class="pwa-btn pwa-btn-light">Not now</button>
            <button id="pwaAndroidInstallNowBtn" type="button" class="pwa-btn pwa-btn-orange">Install now</button>
          </div>
        </div>`;
      document.body.appendChild(dialog);
      dialog.querySelector('#pwaAndroidGuideCloseBtn').addEventListener('click', () => dialog.close());
      dialog.querySelector('#pwaAndroidInstallNowBtn').addEventListener('click', async () => {
        if (deferredInstallPrompt) {
          dialog.close();
          deferredInstallPrompt.prompt();
          try { await deferredInstallPrompt.userChoice; } catch (_) {}
          deferredInstallPrompt = null;
          return;
        }
        const btn = dialog.querySelector('#pwaAndroidInstallNowBtn');
        btn.textContent = samsung ? 'Use browser menu' : 'Use ⋮ browser menu';
      });
    }

    if (!document.getElementById('pwaInstallHelpDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'pwaInstallHelpDialog';
      dialog.className = 'pwa-dialog';
      dialog.setAttribute('aria-labelledby', 'pwaInstallHelpTitle');
      dialog.innerHTML = `
        <div class="pwa-card">
          <div class="pwa-card-icon">⇩</div>
          <div class="pwa-card-eyebrow">INSTALL EDUCORE</div>
          <h2 id="pwaInstallHelpTitle">Install EduCore on this device</h2>
          <p>If the browser install prompt does not appear, open your browser menu <strong>⋮</strong> and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
          <div class="pwa-card-actions">
            <button id="pwaInstallHelpCloseBtn" type="button" class="pwa-btn pwa-btn-orange">Got it</button>
          </div>
        </div>`;
      document.body.appendChild(dialog);
      dialog.querySelector('#pwaInstallHelpCloseBtn').addEventListener('click', () => dialog.close());
    }

    if (!document.getElementById('pwaRuntimeStyles')) {
      const style = document.createElement('style');
      style.id = 'pwaRuntimeStyles';
      style.textContent = `
        .pwa-dialog{border:0;padding:0;border-radius:22px;background:transparent;max-width:none}
        .pwa-dialog::backdrop{background:rgba(30,22,17,.5);backdrop-filter:blur(3px)}
        .pwa-card{width:min(440px,calc(100vw - 36px));padding:26px;border-radius:22px;background:#fff;color:#2f241d;box-shadow:0 24px 70px rgba(47,36,29,.24);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
        .pwa-card-icon{width:52px;height:52px;border-radius:16px;background:#fff1e8;color:#ff6500;display:grid;place-items:center;font-size:26px;margin-bottom:14px}
        .pwa-card-eyebrow{font-size:12px;font-weight:800;letter-spacing:.14em;color:#ff6500;margin-bottom:6px}
        .pwa-card h2{margin:0 0 8px;font-size:25px;line-height:1.1}
        .pwa-card p{margin:0;color:#6e6259;line-height:1.55}
        .pwa-card-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px;flex-wrap:wrap}
        .pwa-btn{border-radius:12px;padding:10px 16px;font-weight:800;cursor:pointer;font:inherit}
        .pwa-btn-light{border:1px solid #ead8cb;background:#fff;color:#2f241d}
        .pwa-btn-orange{border:0;background:#ff6500;color:#fff;padding-inline:18px}
        .pwa-share-icon svg{width:25px;height:25px}
        .pwa-ios-intro{margin-bottom:16px!important}
        .pwa-ios-step-list{display:grid;gap:10px;margin-top:16px}
        .pwa-ios-step{display:grid;grid-template-columns:34px 1fr;gap:11px;align-items:start;padding:12px;border:1px solid #f1dfd2;background:#fffaf6;border-radius:14px}
        .pwa-ios-step-number{width:30px;height:30px;border-radius:10px;background:#ff6500;color:#fff;display:grid;place-items:center;font-weight:900}
        .pwa-ios-step strong{display:block;font-size:14px;color:#2f241d;margin-bottom:2px}
        .pwa-ios-step div span{display:block;font-size:13px;line-height:1.42;color:#6e6259}
        .pwa-ios-result{display:flex;gap:9px;align-items:flex-start;margin-top:14px;padding:11px 12px;border-radius:13px;background:#f3fbf4;color:#36563d;font-size:12px;line-height:1.4}
        .pwa-ios-result-icon{width:20px;height:20px;flex:0 0 20px;border-radius:50%;display:grid;place-items:center;background:#dff3e3;color:#28743a;font-weight:900}
        @media(max-width:520px){
          .pwa-ios-card{padding:20px!important}
          .pwa-ios-card h2{font-size:22px}
          .pwa-ios-step{padding:10px}
        }
        #pwaInstallBtn{white-space:nowrap}
        /* Step 5.7: stable two-row install layout.
           Desktop/tablet: Start + Sign in on row 1, Install centered on row 2.
           Mobile: all three buttons stack full width. No label is allowed to wrap. */
        #pwaInstallBtn{white-space:nowrap!important}
        #publicSite .hero-buttons > .btn{
          min-height:50px!important;
          height:50px!important;
          padding:13px 18px!important;
          font-size:16px!important;
          line-height:1!important;
          white-space:nowrap!important;
          overflow:visible!important;
        }
        .pwa-install-button{
          position:relative!important;
          border:1px solid #4a3326!important;
          color:#fff!important;
          background:#30251d!important;
          box-shadow:0 8px 20px rgba(48,37,29,.16)!important;
          display:inline-flex!important;align-items:center!important;justify-content:center!important;
          transition:transform .18s ease,box-shadow .18s ease,background .18s ease!important;
        }
        .pwa-install-button > span{margin:0!important;font-size:inherit!important;line-height:1!important;font-weight:800!important;white-space:nowrap!important}
        .pwa-install-button .pwa-download-icon{
          position:absolute;right:16px;top:50%;transform:translateY(-50%);
          width:17px;height:17px;display:block;color:#ff8a3d;
        }
        .pwa-install-button:hover{transform:translateY(-2px);background:#3b2d24!important;box-shadow:0 10px 22px rgba(48,37,29,.22)!important}
        .pwa-install-button:focus-visible{outline:3px solid rgba(255,101,0,.25)!important;outline-offset:3px}

        @media(min-width:521px){
          #publicSite .hero-buttons{
            display:grid!important;
            grid-template-columns:repeat(2,210px)!important;
            width:max-content!important;
            max-width:432px!important;
            gap:10px 12px!important;
            align-items:stretch!important;
          }
          #publicSite .hero-buttons > .btn{width:210px!important}
          #publicSite .hero-buttons > #pwaInstallBtn{
            grid-column:1 / -1!important;
            justify-self:center!important;
          }
        }
        @media(max-width:1100px) and (min-width:521px){
          #publicSite .hero-buttons > .btn{font-size:14px!important}
        }
        @media(max-width:520px){
          #publicSite .hero-buttons{
            display:grid!important;
            grid-template-columns:1fr!important;
            width:100%!important;
            max-width:100%!important;
            gap:10px!important;
          }
          #publicSite .hero-buttons > .btn{
            width:100%!important;
            height:50px!important;
            min-height:50px!important;
            font-size:13px!important;
            padding:12px 16px!important;
          }
          .hero-buttons #pwaInstallBtn .pwa-download-icon{width:16px;height:16px;right:16px}
        }
      `;
      document.head.appendChild(style);
    }

    ensureInstallButton();
  }

  function ensureInstallButton() {
    if (isStandalone()) {
      document.getElementById('pwaInstallBtn')?.remove();
      return;
    }

    const actions = document.querySelector('#publicSite .hero-buttons');
    if (!actions || document.getElementById('pwaInstallBtn')) return;

    const button = document.createElement('button');
    button.id = 'pwaInstallBtn';
    button.type = 'button';
    button.className = 'btn btn-large pwa-install-button';
    button.innerHTML = `
      <span>Install EduCore</span>
      <svg class="pwa-download-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

    button.addEventListener('click', async () => {
      if (isIos()) {
        const dialog = document.getElementById('pwaIosInstallDialog');
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
        return;
      }

      if (isAndroid()) {
        const dialog = document.getElementById('pwaAndroidInstallDialog');
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
        return;
      }

      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try {
          const choice = await deferredInstallPrompt.userChoice;
          if (choice && choice.outcome === 'accepted') button.remove();
        } catch (_) {}
        deferredInstallPrompt = null;
        return;
      }

      const help = document.getElementById('pwaInstallHelpDialog');
      if (help && typeof help.showModal === 'function') help.showModal();
    });

    actions.appendChild(button);
  }

  function updateConnectivityUi() {
    ensurePwaUi();
    const banner = document.getElementById('pwaOfflineBanner');
    if (banner) banner.style.display = navigator.onLine ? 'none' : 'block';
  }

  function showUpdatePrompt() {
    ensurePwaUi();
    const dialog = document.getElementById('pwaUpdateDialog');
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  function watchRegistration(registration) {
    registrationRef = registration;

    if (registration.waiting && navigator.serviceWorker.controller) showUpdatePrompt();

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt();
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    ensurePwaUi();
    ensureInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('pwaInstallBtn')?.remove();
  });

  window.addEventListener('online', updateConnectivityUi);
  window.addEventListener('offline', updateConnectivityUi);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    ensurePwaUi();
    updateConnectivityUi();

    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      watchRegistration(registration);
      console.log('EduCore service worker ready:', registration.scope);

      registration.update().catch(() => {});
      window.addEventListener('focus', () => registration.update().catch(() => {}));
    } catch (error) {
      console.error('EduCore service worker registration failed:', error);
    }
  });
})();
