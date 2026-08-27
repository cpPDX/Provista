// More-tab wiring kept separate from feature implementations so Pantry can own
// Pantry behavior without relying on legacy functions that still live in more.js.
function initMoreTabV2() {
  document.querySelectorAll('.more-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => handleMoreSectionNav(btn.dataset.section));
  });

  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', hideMoreSection);
  });

  document.querySelectorAll('[data-insight-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.insightTab));
  });
  document.querySelectorAll('.insights-back').forEach(btn => {
    btn.addEventListener('click', async () => {
      await switchTab('more');
      showMoreSection('insights');
    });
  });

  document.getElementById('btn-add-inventory')?.addEventListener('click', Pantry.openAdd);
  document.getElementById('pantry-search')?.addEventListener('input', event => {
    Pantry.setSearch(event.target.value);
  });

  document.getElementById('btn-add-item-catalog')?.addEventListener('click', openAddCatalogItemModal);
  const scanCatalogBtn = document.getElementById('btn-scan-catalog');
  if (scanCatalogBtn) {
    scanCatalogBtn.addEventListener('click', openScanCatalogItemModal);
    if (!window.appAuth?.features?.barcodeScanning) scanCatalogBtn.style.display = 'none';
  }
  document.getElementById('btn-add-store')?.addEventListener('click', () => {
    promptCreateStore('', async () => {
      await loadStores();
      showToast('Store added');
    });
  });

  document.getElementById('catalog-search')?.addEventListener('input', applyCatalogFilter);
  document.getElementById('btn-catalog-filter')?.addEventListener('click', openCatalogFilterSheet);

  document.getElementById('btn-app-tour')?.addEventListener('click', startAppTour);
  document.getElementById('btn-more-csv-import')?.addEventListener('click', openCsvImportModal);

  const resumeBtn = document.getElementById('btn-resume-setup');
  resumeBtn?.addEventListener('click', startSetupWizard);
}
