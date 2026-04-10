// Main app: auth check, tab navigation, initialization

document.addEventListener('DOMContentLoaded', async () => {
  // Auth check — redirects to /login.html if not authenticated
  const ok = await window.appAuth.load();
  if (!ok) return;

  const { user, household, features } = window.appAuth;

  // Show session expiry notice if using cached auth
  if (window.appAuth.offlineSession) {
    const noCache = typeof offlineDb !== 'undefined' ? !(await offlineDb.hasData()) : true;
    if (noCache) {
      document.getElementById('app').innerHTML = `
        <div class="empty-state" style="padding:2rem">
          <div class="empty-icon">📡</div>
          <p>You need to connect to the internet at least once to load your data for offline use.</p>
        </div>`;
      return;
    }
    showToast('Offline mode — your session expired. Connect to the internet to log back in.', 5000);
  }

  // Apply role class to body for CSS visibility rules
  document.body.classList.add('role-' + user.role);

  // Show user + household info in More tab header
  const userLabel = document.getElementById('user-label');
  if (userLabel) {
    userLabel.textContent = `${user.name} · ${household?.name || ''} · ${capitalizeRole(user.role)}`;
  }

  // Show admin-only items in More menu
  if (window.appAuth.isAdmin()) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
    // Check pending count on load
    try {
      const pending = await api.prices.pending();
      updatePendingBadge(pending.length);
    } catch (_) {}
  }

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (confirm('Sign out?')) await window.appAuth.logout();
  });

  // Attach event handlers immediately so the UI is interactive while offline
  // support initializes in the background
  initNavigation();
  initModal();
  initPricesTab();
  initShoppingListTab();
  initSpendTab();
  initMoreTab();

  // Load default tab
  await loadPricesTab();

  // Initialize offline support AFTER UI is interactive (non-blocking)
  if (features?.offlineAccess) {
    initOfflineSupport();
  }

  // Setup wizard for new household owners
  const resumeBtn = document.getElementById('btn-resume-setup');
  if (shouldShowSetupWizard()) {
    // First login after household creation — auto-start and show resume button
    if (resumeBtn) resumeBtn.style.display = '';
    setTimeout(() => startSetupWizard(), 500);
  } else if (shouldShowResumeButton()) {
    // Wizard not done but not a fresh creation — just show resume button
    if (resumeBtn) resumeBtn.style.display = '';
  }
});

// ============================================================
// Offline Support Initialization
// ============================================================

async function initOfflineSupport() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch {}
  }

  // Initialize offline manager (online/offline detection)
  offlineManager.init();

  // Initialize IndexedDB and bootstrap data
  await offlineBootstrap.init();

  // Initialize iOS install prompt
  if (typeof initInstallPrompt === 'function') {
    initInstallPrompt();
  }
}

function capitalizeRole(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => handleNavTap(item.dataset.tab));
  });
  document.getElementById('btn-open-csv-import')?.addEventListener('click', () => openCsvImportModal());
}

function closeDetailPanel() {
  const panel = document.getElementById('item-detail-panel');
  if (panel && panel.classList.contains('open')) {
    panel.classList.remove('open');
    setTimeout(() => { panel.style.display = 'none'; }, 250);
  }
}

function handleNavTap(tabId) {
  closeDetailPanel();
  const modalOpen = document.getElementById('modal-overlay').style.display !== 'none';
  if (modalOpen && window._dirtyForm?.isDirty) {
    showUnsavedPrompt(() => switchTab(tabId));
  } else {
    if (modalOpen) closeModal();
    switchTab(tabId);
  }
}

async function switchTab(tabId) {
  hideMoreSection();
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + tabId)?.classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tabId}"]`)?.classList.add('active');

  switch (tabId) {
    case 'prices': await loadPricesTab(); break;
    case 'list': await loadShoppingListTab(); break;
    case 'spend': await loadSpendTab(); break;
    case 'inventory': await loadInventory(); break;
    case 'meal-plan':
      if (!window._mealPlanInit) { initMealPlanSection(); window._mealPlanInit = true; }
      await loadMealPlan();
      break;
    case 'more': break; // More tab content is already in the DOM, sub-sections load on demand
  }
}

function initModal() {
  function tryCloseModal() {
    if (window._dirtyForm?.isDirty) {
      showUnsavedPrompt(() => {});
    } else {
      closeModal();
    }
  }

  document.getElementById('modal-close').addEventListener('click', tryCloseModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) tryCloseModal();
  });

  // Escape key closes the modal (respects unsaved-changes guard)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modalOpen = document.getElementById('modal-overlay').style.display !== 'none';
    if (modalOpen) { e.preventDefault(); tryCloseModal(); }
  });
}
