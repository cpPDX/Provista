// Main app: tab navigation and initialization

document.addEventListener('DOMContentLoaded', async () => {
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

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      const tabId = item.dataset.tab;
      switchTab(tabId);
      item.dataset.loaded = 'true';
    });
  });
}

async function switchTab(tabId) {
  // Hide all panels
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show selected
  document.getElementById('tab-' + tabId).classList.add('active');
  document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');

  // Reset More sub-sections
  if (tabId !== 'more') {
    hideMoreSection();
  }

  // Load data for tab
  switch (tabId) {
    case 'prices': await loadPricesTab(); break;
    case 'list': await loadShoppingListTab(); break;
    case 'spend': await loadSpendTab(); break;
  }
}

function initModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
}
