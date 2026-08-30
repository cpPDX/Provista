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

  document.addEventListener('click', event => {
    const homeNav = event.target.closest?.('.nav-item[data-tab="home"]');
    if (!homeNav || wizardIsActive()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    window.location.assign('/app');
  }, true);

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

      if (focus === 'today-dinner' && typeof window.focusTodaysDinner === 'function') {
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
