// More-tab wiring kept separate from feature implementations so Pantry can own
// Pantry behavior without relying on legacy functions that still live in more.js.
function loadHelpAboutSection() {
  const container = document.getElementById('about-content');
  if (!container) return;

  const isAdmin = window.appAuth?.isAdmin();
  container.innerHTML = `
    <div style="text-align:center;padding:0.5rem 0 1.25rem">
      <div style="margin-bottom:0.75rem">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" style="display:inline-block" aria-hidden="true">
          <rect width="48" height="48" rx="12" fill="#21ABCD"/>
          <text x="24" y="35" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="800" fill="#1A1C20" text-anchor="middle" letter-spacing="-0.5">P</text>
        </svg>
      </div>
      <h2 style="font-size:1.25rem;font-weight:800;margin-bottom:0.25rem">Help &amp; About</h2>
      <p class="text-muted text-sm">Provista helps your household plan meals, shop, and keep Pantry in sync.</p>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-body">
        <div class="card-title">How Provista works</div>
        <p class="text-muted text-sm" style="margin-top:0.5rem;line-height:1.65">
          Think of Provista as one household workflow: <strong>Home → Plan → List → Shop → Pantry</strong>.
          Home shows what needs attention, Plan helps decide meals, List collects what you need, and finishing a shopping stop updates the household history behind the scenes.
        </p>
        <button type="button" class="btn btn-outline btn-full" id="btn-help-app-tour" style="margin-top:0.75rem">Restart App Tour</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-body">
        <div class="card-title">Shopping</div>
        <ul style="margin-top:0.5rem;padding-left:1.25rem;line-height:1.75;font-size:0.9rem;color:var(--text-muted)">
          <li>Use rapid capture to add several groceries quickly.</li>
          <li>Use <strong>Add with details</strong> when you need quantity, store preference, or a new catalog item.</li>
          <li>Checking an item means <strong>I bought it</strong> and responds immediately.</li>
          <li>For prices, choose <strong>Use</strong>, <strong>Update price</strong>, or <strong>Later</strong>. A missing price never blocks shopping.</li>
          <li><strong>Finish shopping</strong> completes one store stop at a time, updates Spending and optional Pantry quantities, and removes only the purchased items from the active list.</li>
          <li>If you choose Later, Home keeps the missing price available for review after the trip.</li>
        </ul>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-body">
        <div class="card-title">Pantry</div>
        <p class="text-muted text-sm" style="margin-top:0.5rem;line-height:1.65">
          Pantry does not require perfect inventory. Use <strong>Simple tracking</strong> for Have, Running low, or Out.
          Use <strong>Exact tracking</strong> only when a number is useful; Provista can then mark an item low automatically from its threshold.
          Running low and Out items surface on Home and can be moved onto the shopping list.
        </p>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-body">
        <div class="card-title">Prices &amp; Spending</div>
        <p class="text-muted text-sm" style="margin-top:0.5rem;line-height:1.65">
          Prices and Spending live under <strong>More → Insights</strong>. Household price history represents prices your household actually paid or confirmed.
          Open Prices observations are community-reported shopping context only; they do not become household Spending unless you confirm a purchase price.
        </p>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-body">
        <div class="card-title">Household</div>
        <p class="text-muted text-sm" style="margin-top:0.5rem;line-height:1.65">
          Everyone in the household shares the meal plan, List, and routine Pantry activity. Owners and Admins manage household settings, stores, invites, and other administrative tools.
        </p>
      </div>
    </div>

    <div class="card" style="margin-bottom:${isAdmin ? '1rem' : '0'}">
      <div class="card-body">
        <div class="card-title">About Provista</div>
        <p class="text-muted text-sm" style="margin-top:0.5rem;line-height:1.65">
          Provista is a household grocery planning and shopping assistant built for busy families. Price tracking supports the shopping experience rather than driving it.
        </p>
        <p style="margin-top:0.75rem;font-size:0.9375rem">Created by Chris Phelan</p>
        <p class="text-muted text-sm" style="margin-top:0.25rem">Built for our household. Shared with yours.</p>
      </div>
    </div>

    ${isAdmin ? `
    <div class="card">
      <div class="card-body">
        <div class="card-title">Data Maintenance</div>
        <p class="text-muted text-sm" style="margin-top:0.5rem;margin-bottom:0.75rem">
          Normalize legacy category names (for example, "Dry" to "Pantry") from older CSV imports.
        </p>
        <button class="btn btn-outline btn-sm" id="btn-migrate-categories">Fix Category Names</button>
        <div id="migrate-result" class="text-sm" style="margin-top:0.5rem"></div>
      </div>
    </div>` : ''}
  `;

  document.getElementById('btn-help-app-tour')?.addEventListener('click', startAppTour);

  if (isAdmin) {
    document.getElementById('btn-migrate-categories')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-migrate-categories');
      const result = document.getElementById('migrate-result');
      btn.disabled = true;
      btn.textContent = 'Running…';
      try {
        const res = await api.request('POST', '/admin/migrate-categories');
        result.textContent = res.message;
        result.style.color = 'var(--success)';
      } catch (err) {
        result.textContent = 'Failed: ' + err.message;
        result.style.color = 'var(--danger)';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Fix Category Names';
      }
    });
  }
}

async function openMoreSection(section) {
  if (section === 'about') {
    showMoreSection('about');
    loadHelpAboutSection();
    return;
  }
  await handleMoreSectionNav(section);
}

function initMoreTabV2() {
  document.querySelectorAll('.more-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => openMoreSection(btn.dataset.section));
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
