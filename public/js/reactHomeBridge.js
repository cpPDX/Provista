// Temporary strangler bridge for the React migration.
// Legacy feature screens stay intact, but migrated navigation returns to the
// React production surface. Remove this file when the legacy shell is retired.
(() => {
  function wizardIsActive() {
    try {
      return typeof wizardActive !== 'undefined' && wizardActive;
    } catch (_) {
      return false;
    }
  }

  function tourIsActive() {
    return Boolean(document.querySelector('.tour-tooltip.visible'));
  }

  function legacyShellIsPinned() {
    const params = new URLSearchParams(window.location.search);
    return window.location.pathname === '/legacy-app' || params.get('legacy') === '1';
  }

  function openReactHome() {
    window.location.assign('/app');
  }

  // Catch direct bottom-nav clicks before the legacy handler mutates the DOM.
  // Explicit legacy contexts are pinned so onboarding and regression coverage
  // can continue using the legacy shell until those flows migrate.
  document.addEventListener('click', event => {
    const homeNav = event.target.closest?.('.nav-item[data-tab="home"]');
    if (!homeNav || legacyShellIsPinned() || wizardIsActive() || tourIsActive()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openReactHome();
  }, true);

  // Some legacy workflows call switchTab('home') directly instead of clicking
  // the nav. Preserve those calls while an onboarding/tour step is visibly
  // active or the current legacy surface is explicitly pinned.
  const legacySwitchTab = window.switchTab;
  if (typeof legacySwitchTab === 'function') {
    window.switchTab = async function bridgedSwitchTab(tabId, ...args) {
      if (tabId === 'home' && !legacyShellIsPinned() && !wizardIsActive() && !tourIsActive()) {
        openReactHome();
        return;
      }
      return legacySwitchTab.call(this, tabId, ...args);
    };
  }

  function todaysDinnerInput() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const day = [...document.querySelectorAll('.meal-day[data-date]')]
      .find(element => element.dataset.date.slice(0, 10) === today);
    return day?.querySelector('.meal-type-section[data-meal-type="dinner"] .meal-name-input') || null;
  }

  async function applyRequestedFocusOrAction() {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focus');
    const action = params.get('action');
    if (!focus && !action) return;

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (focus === 'rapid-list-input') {
        const input = document.getElementById('rapid-list-input');
        if (input) {
          input.focus({ preventScroll: true });
          input.scrollIntoView({ block: 'nearest' });
          return;
        }
      }

      if (focus === 'today-dinner' && typeof window.focusTodaysDinner === 'function' && todaysDinnerInput()) {
        window.focusTodaysDinner();
        return;
      }

      if (action === 'scan-list-item') {
        const button = document.getElementById('btn-scan-list-item');
        if (button) {
          button.click();
          return;
        }
      }

      if (action === 'review-low-stock') {
        const button = document.getElementById('btn-low-stock');
        if (button && button.style.display !== 'none') {
          button.click();
          return;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  window.addEventListener('load', () => {
    void applyRequestedFocusOrAction();
  });
})();
