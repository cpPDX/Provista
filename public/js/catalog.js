// Manage Products browsing/filtering owns its data requirements here. In particular,
// Last purchased uses Item.lastPurchasedAt from the catalog API and never depends
// on Price History having been opened in this browser session.
window.Catalog = (() => {
  async function load() {
    const container = document.getElementById('catalog-list');
    if (container) container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
      catalogState.items = await api.items.list();
      applyFilter();
      updateCatalogBackBanner();
      if (window.appAuth?.isAdmin()) updateDuplicateBanner();
    } catch (err) {
      handleError(err, 'Failed to load products');
    }
  }

  function applyFilter() {
    const { categories, organic, sortBy } = catalogFilterState;
    const q = (document.getElementById('catalog-search')?.value || '').trim().toLowerCase();

    const items = catalogState.items.filter(item => {
      if (q && ![item.name, item.category, item.brand].some(value => String(value || '').toLowerCase().includes(q))) return false;
      if (categories.length && !categories.includes(item.category)) return false;
      if (organic === 'organic' && !item.isOrganic) return false;
      if (organic === 'conventional' && item.isOrganic) return false;
      return true;
    });

    if (sortBy === 'lastPurchased') {
      items.sort((a, b) => {
        const aDate = a.lastPurchasedAt ? new Date(a.lastPurchasedAt).getTime() : null;
        const bDate = b.lastPurchasedAt ? new Date(b.lastPurchasedAt).getTime() : null;
        if (aDate === null && bDate === null) return a.name.localeCompare(b.name);
        if (aDate === null) return 1;
        if (bDate === null) return -1;
        return bDate - aDate || a.name.localeCompare(b.name);
      });
    } else {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }

    catalogState.filtered = items;
    render();

    const isFiltered = categories.length || organic !== 'all';
    const countBar = document.getElementById('catalog-filter-count');
    if (countBar) {
      countBar.textContent = isFiltered ? `Showing ${items.length} of ${catalogState.items.length} products` : '';
      countBar.style.display = isFiltered ? '' : 'none';
    }
    const dot = document.getElementById('catalog-filter-dot');
    if (dot) dot.style.display = (isFiltered || sortBy !== 'name') ? '' : 'none';
  }

  function render() {
    const container = document.getElementById('catalog-list');
    if (!container) return;
    const items = catalogState.filtered;
    if (!items.length) {
      container.innerHTML = emptyState('🏷️', 'No products found.');
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="card swipeable" data-item-id="${escapeAttr(item._id)}">
        <button type="button" class="card-body-wrap" aria-label="Edit ${escapeAttr(item.name)}">
          <div class="card-body">
            <div class="card-title">${escapeHtml(item.name)}${item.isOrganic ? ' <span class="badge badge-organic">Organic</span>' : ''}</div>
            <div class="card-subtitle">${formatItemMeta(item)}</div>
            ${catalogFilterState.sortBy === 'lastPurchased'
              ? `<div class="text-muted text-sm">${item.lastPurchasedAt ? `Last purchased ${escapeHtml(formatDate(item.lastPurchasedAt))}` : 'No purchase history'}</div>`
              : ''}
          </div>
        </button>
        <button type="button" class="card-swipe-delete" aria-label="Delete ${escapeAttr(item.name)}">Delete</button>
      </div>`).join('');

    container.querySelectorAll('.card.swipeable').forEach(card => {
      const id = card.dataset.itemId;
      const item = items.find(candidate => candidate._id === id);
      if (!item) return;
      card.querySelector('.card-body-wrap')?.addEventListener('click', () => {
        openEditItemModal(id, item.name, item.category, item.unit, !!item.isOrganic, item.brand || '', item.size);
      });
      card.querySelector('.card-swipe-delete')?.addEventListener('click', () => deleteItem(id));
      attachSwipeDelete(card);
    });
  }

  function openFilterSheet() {
    const categories = [...new Set(catalogState.items.map(item => item.category).filter(Boolean))].sort();
    const filter = catalogFilterState;
    document.getElementById('filter-sheet-title').textContent = 'Filter & Sort';
    document.getElementById('filter-sheet-body').innerHTML = `
      <div>
        <div class="filter-section-label">Sort by</div>
        <div class="filter-chips" id="catalog-sort-chips">
          <button type="button" class="filter-chip${filter.sortBy === 'name' ? ' selected' : ''}" data-sort="name">Name A→Z</button>
          <button type="button" class="filter-chip${filter.sortBy === 'lastPurchased' ? ' selected' : ''}" data-sort="lastPurchased">Last purchased</button>
        </div>
      </div>
      ${categories.length ? `<div>
        <div class="filter-section-label">Category</div>
        <div class="filter-chips" id="catalog-category-chips">
          ${categories.map(category => `<button type="button" class="filter-chip${filter.categories.includes(category) ? ' selected' : ''}" data-category="${escapeAttr(category)}">${escapeHtml(category)}</button>`).join('')}
        </div>
      </div>` : ''}
      <div>
        <div class="filter-section-label">Organic</div>
        <div class="filter-chips" id="catalog-organic-chips">
          ${[['all', 'All'], ['organic', 'Organic only'], ['conventional', 'Conventional only']].map(([value, label]) =>
            `<button type="button" class="filter-chip${filter.organic === value ? ' selected' : ''}" data-organic="${value}">${label}</button>`
          ).join('')}
        </div>
      </div>`;

    document.querySelectorAll('#catalog-sort-chips [data-sort]').forEach(button => {
      button.addEventListener('click', () => {
        catalogFilterState.sortBy = button.dataset.sort;
        button.parentElement.querySelectorAll('.filter-chip').forEach(candidate => candidate.classList.toggle('selected', candidate === button));
      });
    });
    document.querySelectorAll('#catalog-category-chips [data-category]').forEach(button => {
      button.addEventListener('click', () => {
        const category = button.dataset.category;
        if (catalogFilterState.categories.includes(category)) {
          catalogFilterState.categories = catalogFilterState.categories.filter(value => value !== category);
          button.classList.remove('selected');
        } else {
          catalogFilterState.categories.push(category);
          button.classList.add('selected');
        }
      });
    });
    document.querySelectorAll('#catalog-organic-chips [data-organic]').forEach(button => {
      button.addEventListener('click', () => {
        catalogFilterState.organic = button.dataset.organic;
        button.parentElement.querySelectorAll('.filter-chip').forEach(candidate => candidate.classList.toggle('selected', candidate === button));
      });
    });

    document.getElementById('filter-sheet-clear').onclick = () => {
      catalogFilterState = { categories: [], organic: 'all', sortBy: 'name' };
      closeFilterSheet();
      applyFilter();
    };
    document.getElementById('filter-sheet-done').onclick = () => {
      closeFilterSheet();
      applyFilter();
    };
    const overlay = document.getElementById('filter-sheet-overlay');
    const closeAndApply = () => { closeFilterSheet(); applyFilter(); };
    activateDialogSurface(overlay, document.getElementById('filter-sheet'), document.getElementById('filter-sheet-done'), closeAndApply);
    overlay.onclick = event => {
      if (event.target === overlay) closeAndApply();
    };
  }

  return { load, applyFilter, openFilterSheet };
})();
