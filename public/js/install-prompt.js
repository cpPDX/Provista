// iOS Install Prompt & Android beforeinstallprompt handling

function initInstallPrompt() {
  // Track visit count
  const visits = parseInt(localStorage.getItem('provista_visits') || '0') + 1;
  localStorage.setItem('provista_visits', visits);

  // Android/Chrome: capture the native prompt event
  window.addEventListener('beforeinstallprompt', (e) => {
    // Let the browser handle it natively — no custom prompt needed
  });

  // iOS: show custom prompt if conditions are met
  if (shouldShowIOSPrompt(visits)) {
    // Delay slightly so the app loads first
    setTimeout(() => showIOSInstallSheet(), 1500);
  }
}

function shouldShowIOSPrompt(visits) {
  // Must be iOS Safari
  if (!isIOSSafari()) return false;

  // Must not already be installed (standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches) return false;
  if (navigator.standalone) return false;

  // Must have logged in (appAuth loaded)
  if (!window.appAuth?.user) return false;

  // Must have visited at least 2 times
  if (visits < 2) return false;

  // Check permanent dismiss
  if (localStorage.getItem('installPromptDismissed') === 'true') return false;

  // Check "remind later" — wait 7 days
  const remindLater = localStorage.getItem('installPromptRemindAt');
  if (remindLater && new Date().getTime() < parseInt(remindLater)) return false;

  return true;
}

function isIOSSafari() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
  return isIOS && isSafari;
}

function showIOSInstallSheet() {
  // Don't show if already visible
  if (document.getElementById('install-sheet-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'install-sheet-overlay';
  overlay.className = 'install-sheet-overlay';

  // Share icon SVG for iOS
  const shareIcon = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 2L10 12M10 2L7 5M10 2L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M4 8V16C4 16.5523 4.44772 17 5 17H15C15.5523 17 16 16.5523 16 16V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  overlay.innerHTML = `
    <div class="install-sheet">
      <h3>Use Provista in the store</h3>
      <p>Add to your home screen to access your shopping list and price history even without a connection &mdash; no WiFi needed in the store.</p>
      <div class="install-steps">
        <div class="install-step">
          <span class="install-step-num">1</span>
          <span>Tap the Share button ${shareIcon} at the bottom of Safari</span>
        </div>
        <div class="install-step">
          <span class="install-step-num">2</span>
          <span>Scroll down and tap <strong>Add to Home Screen</strong></span>
        </div>
        <div class="install-step">
          <span class="install-step-num">3</span>
          <span>Tap <strong>Add</strong> in the top right</span>
        </div>
      </div>
      <div class="install-sheet-actions">
        <button class="btn btn-outline" id="install-remind-later">Remind me later</button>
        <button class="btn btn-primary" id="install-got-it">Got it</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Close on overlay tap (outside sheet)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismissInstallSheet('later');
  });

  document.getElementById('install-got-it').addEventListener('click', () => {
    dismissInstallSheet('permanent');
  });

  document.getElementById('install-remind-later').addEventListener('click', () => {
    dismissInstallSheet('later');
  });
}

function dismissInstallSheet(type) {
  const overlay = document.getElementById('install-sheet-overlay');
  if (overlay) overlay.remove();

  if (type === 'permanent') {
    localStorage.setItem('installPromptDismissed', 'true');
  } else {
    // Remind after 7 days
    const remindAt = new Date().getTime() + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem('installPromptRemindAt', String(remindAt));
  }
}
