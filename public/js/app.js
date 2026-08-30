// Main app: auth check, tab navigation, initialization

let rapidShoppingCaptureLoadPromise = null;
let storeSectionsLoadPromise = null;
const LEGACY_TAB_IDS = new Set(['home', 'prices', 'list', 'spend', 'inventory', 'meal-plan', 'more']);

async function ensureStoreSections() {
  if (window.openStoreSectionPicker) return;
  if (!storeSectionsLoadPromise) {
    storeSectionsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/js/storeSections.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load store sections'));
      document.head.appendChild(script);
    });
  }
  try {
    await storeSectionsLoadPromise;
  } catch (err) {
    // Shopping remains fully usable if the enhancement cannot load.
    storeSectionsLoadPromise = null;
    console.error('Store sections failed to load', err);
  }
}

async function ensureRapidShoppingCapture() {
  if (typeof initRapidShoppingCapture === 'function') {
    initRapidShoppingCapture();
    return;
  }

  if (!rapidShoppingCaptureLoadPromise) {
    rapidShoppingCaptureLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/js/rapidShoppingCapture.js';
      script.dataset.rapidShoppingCapture = 'true';
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error('Failed to load rapid shopping capture'));
      };
      document.head.appendChild(script);
    });
  }

  try {
    await rapidShoppingCaptureLoadPromise;
    if (typeof initRapidShoppingCapture === 'function') initRapidShoppingCapture();
  } catch (err) {
    rapidShoppingCaptureLoadPromise = null;
    console.error('Rapid shopping capture failed to load', err);
  }
}

function requestedInitialTab() {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab && LEGACY_TAB_IDS.has(tab) ? tab : 'home';
}

document.addEventListener('DOMContentLoaded', async () => {
  // Auth check — returns to the public page with sign-in open when needed
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
    try {
      const pending = await api.prices.pending();
      updatePendingBadge(pending.length);
    } catch (_) {}
  }

  document.getElementById('btn-logout').addEventListener('click', async () => {
    const confirmed = await confirmAction({
      title: 'Sign out?',
      message: 'You’ll return to the sign-in screen. Your household data stays saved.',
      confirmLabel: 'Sign out',
      danger: false
    });
    if (confirmed) await window.appAuth.logout();
  });

  // Store-section behavior wraps the List renderer, so load it before app
  // initialization. Failure is non-blocking and leaves the original List intact.
  await ensureStoreSections();

  // Attach event handlers immediately so the UI is interactive while offline
  // support initializes in the background.
  initNavigation();
  initModal();
  initPricesTab();
  initShoppingListTab();
  initSpendTab();
  initMoreTabV2();
  initHomeTab();

  // Load Home first so legacy initialization remains stable, then honor a
  // validated deep link from the React migration shell when one is present.
  await loadHomeTab();
  const initialTab = requestedInitialTab();
  if (initialTab !== 'home') await switchTab(initialTab);

  // Initialize offline support AFTER UI is interactive (non-blocking)
  if (features?.offlineAccess) {
    initOfflineSupport();
  }

  // Setup wizard for new household owners
  const resumeBtn = document.getElementById('btn-resume-setup');
  if (shouldShowSetupWizard()) {
    if (resumeBtn) resumeBtn.style.display = '';
    setTimeout(() => startSetupWizard(), 500);
  } else if (shouldShowResumeButton()) {
    if (resumeBtn) resumeBtn.style.display = '';
  }
});

// ============================================================
// Offline Support Initialization
// ============================================================

async function initOfflineSupport() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch {}
  }

  offlineManager.init();
  await offlineBootstrap.init();

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

function waitForDirtySaveOutcome(form) {
  const overlay = document.getElementById('modal-overlay');
  const submit = formSubmitButton(form);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      resolve(value);
    };
    const check = () => {
      const modalOpen = overlay?.style.display !== 'none';
      if (!modalOpen) return finish(true);
      // Every current dirty-form submit disables its submit button before the
      // async write. Re-enabled while the modal remains open means validation
      // or persistence failed and navigation must not continue.
      if (submit && !submit.disabled) finish(false);
    };
    const observer = new MutationObserver(check);
    if (overlay) observer.observe(overlay, { attributes: true, attributeFilter: ['style'] });
    if (submit) observer.observe(submit, { attributes: true, attributeFilter: ['disabled'] });
    setTimeout(check, 0);
  });
}

function showUnsavedNavigationPrompt(onLeave) {
  const prompt = document.getElementById('unsaved-prompt');
  if (!prompt) { onLeave(); return; }

  const keepButton = document.getElementById('unsaved-cancel');
  const saveButton = document.getElementById('unsaved-save');
  const discardButton = document.getElementById('unsaved-leave');
  keepButton.textContent = 'Keep editing';
  saveButton.textContent = 'Save & leave';
  discardButton.textContent = 'Discard & leave';
  prompt.style.display = '';

  const hide = () => { prompt.style.display = 'none'; };
  keepButton.onclick = hide;
  discardButton.onclick = () => {
    hide();
    clearDirtyForm();
    closeModal();
    onLeave();
  };
  saveButton.onclick = async () => {
    const dirty = window._dirtyForm;
    const callback = dirty?.saveCallback;
    const form = document.querySelector('#modal-body form');

    if (!callback) {
      hide();
      clearDirtyForm();
      closeModal();
      onLeave();
      return;
    }
    if (form && !form.reportValidity()) {
      hide();
      return;
    }

    saveButton.disabled = true;
    keepButton.disabled = true;
    discardButton.disabled = true;
    saveButton.textContent = 'Saving…';
    hide();

    try {
      const callbackResult = callback();
      let saved;
      if (callbackResult && typeof callbackResult.then === 'function') {
        await callbackResult;
        saved = document.getElementById('modal-overlay')?.style.display === 'none';
      } else {
        saved = await waitForDirtySaveOutcome(form);
      }

      if (!saved) {
        // The form stays open with its existing validation/error feedback.
        return;
      }

      clearDirtyForm();
      if (document.getElementById('modal-overlay')?.style.display !== 'none') closeModal();
      await onLeave();
    } catch (err) {
      // A rejecting save callback means the current form remains authoritative.
      // Do not clear dirty state or perform the requested navigation.
      handleError(err, 'Could not save changes');
    } finally {
      saveButton.disabled = false;
      keepButton.disabled = false;
      discardButton.disabled = false;
      saveButton.textContent = 'Save & leave';
    }
  };
}

function handleNavTap(tabId) {
  closeDetailPanel();
  const modalOpen = document.getElementById('modal-overlay').style.display !== 'none';
  if (modalOpen && window._dirtyForm?.isDirty) {
    showUnsavedNavigationPrompt(() => switchTab(tabId));
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
    case 'home': await loadHomeTab(); break;
    case 'prices': await loadPricesTab(); break;
    case 'list':
      await ensureRapidShoppingCapture();
      // Stores can change from More or another household member while the app
      // stays open. Clear the List cache on navigation so checkout never offers
      // stale store choices or loses the active-stop label.
      if (typeof listState !== 'undefined') listState.stores = [];
      await loadShoppingListTab();
      break;
    case 'spend': await loadSpendTab(); break;
    case 'inventory': await Pantry.load(); break;
    case 'meal-plan':
      if (!window._mealPlanInit) { initMealPlanSection(); window._mealPlanInit = true; }
      await loadMealPlan();
      break;
    case 'more': break;
  }
}

function initModal() {
  function tryCloseModal() {
    if (window._dirtyForm?.isDirty) {
      showUnsavedNavigationPrompt(() => {});
    } else {
      closeModal();
    }
  }

  document.getElementById('modal-close').addEventListener('click', tryCloseModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) tryCloseModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modalOpen = document.getElementById('modal-overlay').style.display !== 'none';
    if (modalOpen) { e.preventDefault(); tryCloseModal(); }
  });
}
