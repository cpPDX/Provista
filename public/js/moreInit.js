// More-tab wiring kept separate from feature implementations so Pantry and
// Manage Products can own their behavior without relying on legacy functions
// that still live in more.js during incremental decomposition.
let catalogModuleLoadPromise = null;

async function ensureCatalogModule() {
  if (window.Catalog) return window.Catalog;
  if (!catalogModuleLoadPromise) {
    catalogModuleLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/js/catalog.js';
      script.dataset.catalogModule = 'true';
      script.onload = () => resolve(window.Catalog);
      script.onerror = () => {
        script.remove();
        reject(new Error('Failed to load Manage Products'));
      };
      document.head.appendChild(script);
    });
  }
  try {
    return await catalogModuleLoadPromise;
  } catch (err) {
    catalogModuleLoadPromise = null;
    throw err;
  }
}

function initMoreTabV2() {
  document.querySelectorAll('.more-item[data-section]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const section = btn.dataset.section;
      if (section === 'items') {
        showMoreSection(section);
        try {
          const catalog = await ensureCatalogModule();
          await catalog.load();
        } catch (err) {
          handleError(err, 'Failed to load products');
        }
        return;
      }
      await handleMoreSectionNav(section);
    });
  });

  document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', hideMoreSection);
  });

  document.querySelectorAll('[data-insight-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.insightTab === 'prices' && typeof pricesState !== 'undefined') {
        pricesState.returnToSpendMonth = null;
        pricesState.spendingDrilldown = null;
      }
      switchTab(btn.dataset.insightTab);
    });
  });
  document.querySelectorAll('.insights-back').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fromPrices = Boolean(btn.closest('#tab-prices'));
      const spendMonth = fromPrices && typeof pricesState !== 'undefined'
        ? pricesState.returnToSpendMonth
        : null;

      if (spendMonth && typeof spendState !== 'undefined') {
        spendState.currentMonth = spendMonth;
        pricesState.returnToSpendMonth = null;
        pricesState.spendingDrilldown = null;
        await switchTab('spend');
        return;
      }

      await switchTab('more');
      showMoreSection('insights');
    });
  });

  document.getElementById('btn-add-inventory')?.addEventListener('click', Pantry.openAdd);
  document.getElementById('pantry-search')?.addEventListener('input', event => {
    Pantry.setSearch(event.target.value);
  });

  document.getElementById('btn-add-item-catalog')?.addEventListener('click', async () => {
    try {
      const catalog = await ensureCatalogModule();
      promptCreateItem('', async () => {
        await catalog.load();
        showToast('Product created');
      });
    } catch (err) {
      handleError(err, 'Failed to open Add product');
    }
  });
  const scanCatalogBtn = document.getElementById('btn-scan-catalog');
  if (scanCatalogBtn) {
    scanCatalogBtn.addEventListener('click', async () => {
      if (!window.BarcodeScanner) return showToast('Scanner unavailable. Try reloading the page.', 3000);
      let catalog;
      try { catalog = await ensureCatalogModule(); } catch (err) { return handleError(err, 'Failed to load products'); }
      BarcodeScanner.open(async upc => {
        if (!upc) return;
        await handleBarcodeResult(upc, async () => {
          await catalog.load();
          showToast('Product added via barcode scan');
        });
      });
    });
    if (!window.appAuth?.features?.barcodeScanning) scanCatalogBtn.style.display = 'none';
  }
  document.getElementById('btn-add-store')?.addEventListener('click', () => {
    promptCreateStore('', async () => {
      await loadStores();
      showToast('Store added');
    });
  });

  document.getElementById('catalog-search')?.addEventListener('input', async () => {
    try { (await ensureCatalogModule()).applyFilter(); } catch (err) { handleError(err, 'Failed to filter products'); }
  });
  document.getElementById('btn-catalog-filter')?.addEventListener('click', async () => {
    try { (await ensureCatalogModule()).openFilterSheet(); } catch (err) { handleError(err, 'Failed to open product filters'); }
  });

  document.getElementById('btn-app-tour')?.addEventListener('click', startAppTour);
  document.getElementById('btn-more-csv-import')?.addEventListener('click', openCsvImportModal);

  const resumeBtn = document.getElementById('btn-resume-setup');
  resumeBtn?.addEventListener('click', startSetupWizard);
}
