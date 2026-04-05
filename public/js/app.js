// Main app: auth check, tab navigation, initialization

document.addEventListener('DOMContentLoaded', async () => {
  // Auth check — redirects to /login.html if not authenticated
  const ok = await window.appAuth.load();
  if (!ok) return;

  const { user, household } = window.appAuth;

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

  // Wire member-only scan note
  if (window.appAuth.isMember()) {
    const note = document.getElementById('scan-member-note');
    if (note) note.style.display = '';
  }

  initNavigation();
  initModal();
  initPricesTab();
  initShoppingListTab();
  initScanTab();
  initSpendTab();
  initMoreTab();

  // Load default tab
  await loadPricesTab();
});

function capitalizeRole(role) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });
}

async function switchTab(tabId) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');

  if (tabId !== 'more') hideMoreSection();

  switch (tabId) {
    case 'prices': await loadPricesTab(); break;
    case 'list': await loadShoppingListTab(); break;
    case 'scan': await loadScanTab(); break;
    case 'spend': await loadSpendTab(); break;
  }
}

function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
}
