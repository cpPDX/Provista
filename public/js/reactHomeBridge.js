// Temporary strangler bridge for PRO-52.
// Legacy feature screens stay intact, but Home navigation returns to the React
// production surface. Remove this file when the legacy shell is retired.
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

  function openReactHome() {
    window.location.assign('/app');
  }

  // Catch direct bottom-nav clicks before the legacy handler mutates the DOM.
  document.addEventListener('click', event => {
    const homeNav = event.target.closest?.('.nav-item[data-tab="home"]');
    if (!homeNav || wizardIsActive() || tourIsActive()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openReactHome();
  }, true);

  // Some legacy workflows call switchTab('home') directly instead of clicking
  // the nav. Preserve those calls while an onboarding/tour step is visibly
  // active, then return to React Home when the workflow closes or completes.
  const legacySwitchTab = window.switchTab;
  if (typeof legacySwitchTab === 'function') {
    window.switchTab = async function bridgedSwitchTab(tabId, ...args) {
      if (tabId === 'home' && !wizardIsActive() && !tourIsActive()) {
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

  async function applyRequestedFocus() {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (!focus) return;

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

      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  window.addEventListener('load', () => {
    void applyRequestedFocus();
  });
})();
