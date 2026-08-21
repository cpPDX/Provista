// Home-first product shell and shopping-loop enhancements.
// Loaded by app.js after the existing feature scripts so this can progressively
// simplify navigation without rewriting the legacy screens all at once.

function productLocalDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function preferredUserName() {
  const user = window.appAuth?.user || {};
  return String(user.displayName || user.name || 'there').trim().split(/\s+/)[0] || 'there';
}

function ensureHomeStyles() {
  if (document.querySelector('link[data-home-shell]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/home.css';
  link.dataset.homeShell = 'true';
  document.head.appendChild(link);
}

function enableBrowserZoom() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
}

function installHomePanel() {
  if (document.getElementById('tab-home')) return;
  const app = document.getElementById('app');
  if (!app) return;

  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
  const section = document.createElement('section');
  section.className = 'tab-panel active';
  section.id = 'tab-home';
  section.innerHTML = `
    <div class="home-shell">
      <header class="page-header home-hero">
        <div>
          <h1 id="home-greeting">Home</h1>
          <div class="home-date" id="home-date"></div>
        </div>
        <button class="btn btn-primary btn-sm" id="home-quick-add">+ Quick Add</button>
      </header>
      <div id="home-content">
        <div class="empty-state"><div class="spinner"></div></div>
      </div>
    </div>`;
  app.prepend(section);
}

function installPrimaryNavigation() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  nav.innerHTML = `
    <button class="nav-item active" data-tab="home">
      <span class="nav-icon">⌂</span><span>Home</span>
    </button>
    <button class="nav-item" data-tab="meal-plan">
      <span class="nav-icon">🥗</span><span>Plan</span>
    </button>
    <button class="nav-item" data-tab="list">
      <span class="nav-icon">📋</span><span>List</span>
    </button>
    <button class="nav-item" data-tab="inventory">
      <span class="nav-icon">🧺</span><span>Pantry</span>
    </button>
    <button class="nav-item" data-tab="more">
      <span class="nav-icon">☰</span><span>More</span>
      <span id="nav-pending-dot" class="nav-pending-dot" style="display:none"></span>
    </button>`;

  const inventoryTitle = document.querySelector('#tab-inventory .page-header h1');
  if (inventoryTitle) inventoryTitle.textContent = 'Pantry';
}

function installInsightsLinks() {
  const menu = document.querySelector('#tab-more .more-menu');
  if (!menu || document.getElementById('more-insights-prices')) return;

  const label = document.createElement('div');
  label.className = 'section-title';
  label.style.padding = '0.9rem 1rem 0.35rem';
  label.textContent = 'Insights';

  const prices = document.createElement('button');
  prices.className = 'more-item';
  prices.id = 'more-insights-prices';
  prices.innerHTML = '<span class="more-icon">💰</span><span>Price Insights</span><span class="chevron">›</span>';
  prices.addEventListener('click', () => switchTab('prices'));

  const spend = document.createElement('button');
  spend.className = 'more-item';
  spend.id = 'more-insights-spend';
  spend.innerHTML = '<span class="more-icon">📊</span><span>Spending Insights</span><span class="chevron">›</span>';
  spend.addEventListener('click', () => switchTab('spend'));

  menu.append(label, prices, spend);
}

function installQuickCapture() {
  const tab = document.getElementById('tab-list');
  const summary = document.getElementById('list-summary');
  if (!tab || !summary || document.getElementById('list-quick-input')) return;

  const quick = document.createElement('div');
  quick.className = 'list-quick-capture';
  quick.innerHTML = `
    <div class="list-quick-row">
      <input class="form-control" id="list-quick-input" autocomplete="off" inputmode="text"
        placeholder="Add milk, eggs, bananas x2…" aria-label="Quick add shopping items" />
      <button class="btn btn-primary" id="list-quick-add">Add</button>
    </div>
    <div class="quick-item-chips" id="quick-item-chips"></div>`;
  summary.parentNode.insertBefore(quick, summary);

  const input = document.getElementById('list-quick-input');
  document.getElementById('list-quick-add').addEventListener('click', () => addQuickShoppingText(input.value));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addQuickShoppingText(input.value);
    }
  });
}

function initProductShell() {
  if (window._productShellInitialized) return;
  window._productShellInitialized = true;
  ensureHomeStyles();
  enableBrowserZoom();
  installHomePanel();
  installPrimaryNavigation();
  installInsightsLinks();
  installQuickCapture();

  document.getElementById('home-quick-add')?.addEventListener('click', async () => {
    await switchTab('list');
    setTimeout(() => document.getElementById('list-quick-input')?.focus(), 0);
  });
}

function renderQuickItemChips(items = []) {
  const container = document.getElementById('quick-item-chips');
  if (!container) return;
  container.innerHTML = '';
  items.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-item-chip';
    button.textContent = item.name;
    button.addEventListener('click', () => addKnownItemToList(item.itemId, item.name, 1));
    container.appendChild(button);
  });
}

async function loadHomeTab() {
  const container = document.getElementById('home-content');
  if (!container) return;
  try {
    const data = await api.home.today(productLocalDateValue());
    window._homeToday = data;
    renderQuickItemChips(data.frequentItems || []);

    const date = new Date(`${data.date}T12:00:00`);
    const dateText = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    document.getElementById('home-greeting').textContent = `Hi ${preferredUserName()}`;
    document.getElementById('home-date').textContent = dateText;

    const dinnerTitle = data.dinner?.length
      ? data.dinner.map(meal => escapeHtml(meal.name)).join(' + ')
      : 'Not planned yet';
    const dinnerDetail = data.dinner?.find(meal => meal.notes)?.notes || (data.dinner?.length ? 'Dinner is planned.' : 'Add tonight’s dinner.');
    const lowNames = (data.lowStock || []).slice(0, 2).map(item => item.name);
    const lowDetail = data.lowStock?.length
      ? `${lowNames.join(', ')}${data.lowStock.length > 2 ? ` +${data.lowStock.length - 2} more` : ''}`
      : 'Staples look good.';

    container.innerHTML = `
      <div class="home-grid">
        <button class="home-card" type="button" data-home-tab="meal-plan">
          <div class="home-card-label">Tonight</div>
          <div class="home-card-value">${dinnerTitle}</div>
          <div class="home-card-detail">${escapeHtml(dinnerDetail)}</div>
        </button>
        <button class="home-card" type="button" data-home-tab="list">
          <div class="home-card-label">What we need</div>
          <div class="home-card-value">${data.shoppingCount} item${data.shoppingCount === 1 ? '' : 's'}</div>
          <div class="home-card-detail">${data.shoppingCount ? 'Ready on the shopping list.' : 'Shopping list is clear.'}</div>
        </button>
        <button class="home-card home-card-wide" type="button" data-home-tab="inventory">
          <div class="home-card-label">Running low</div>
          <div class="home-card-value">${data.lowStock?.length || 0} staple${data.lowStock?.length === 1 ? '' : 's'}</div>
          <div class="home-card-detail">${escapeHtml(lowDetail)}</div>
        </button>
      </div>
      <button class="btn btn-primary home-next-action" id="home-next-action" type="button" ${data.nextAction?.tab ? '' : 'disabled'}>
        <strong>${escapeHtml(data.nextAction?.label || 'You’re caught up')}</strong><br />
        <span style="font-weight:500;opacity:0.85">${escapeHtml(data.nextAction?.detail || '')}</span>
      </button>`;

    container.querySelectorAll('[data-home-tab]').forEach(button => {
      button.addEventListener('click', () => switchTab(button.dataset.homeTab));
    });
    const next = document.getElementById('home-next-action');
    if (next && data.nextAction?.tab) next.addEventListener('click', () => switchTab(data.nextAction.tab));
  } catch (err) {
    container.innerHTML = emptyState('⌂', 'Home could not be loaded.');
    handleError(err, 'Failed to load Home');
  }
}

function parseQuickToken(raw) {
  const cleaned = String(raw || '').trim();
  const match = cleaned.match(/^(.*?)(?:\s+x(\d+(?:\.\d+)?))?$/i);
  const name = String(match?.[1] || '').trim();
  const quantity = match?.[2] ? Number(match[2]) : 1;
  return { name, quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1 };
}

async function addKnownItemToList(itemId, name, quantity = 1) {
  if (!itemId) return;
  const existing = typeof listState !== 'undefined'
    ? listState.items.find(item => String(item.itemId?._id || item.itemId) === String(itemId) && !item.checked)
    : null;
  if (existing) {
    await api.shoppingList.update(existing._id, { quantity: Number(existing.quantity || 1) + quantity });
  } else {
    await api.shoppingList.add({ itemId, quantity });
  }
  await loadShoppingListTab();
  showToast(`${name} added`);
}

async function addQuickShoppingText(value) {
  const input = document.getElementById('list-quick-input');
  const tokens = String(value || '').split(/[,\n]+/).map(parseQuickToken).filter(token => token.name);
  if (!tokens.length) return;

  const button = document.getElementById('list-quick-add');
  if (button) { button.disabled = true; button.textContent = 'Adding…'; }
  const missing = [];
  let added = 0;

  try {
    for (const token of tokens) {
      const results = await api.items.search(token.name);
      const exact = results.find(item => String(item.name || '').trim().toLowerCase() === token.name.toLowerCase());
      const match = exact || (results.length === 1 ? results[0] : null);
      if (!match) {
        missing.push(token.name);
        continue;
      }

      const existing = listState.items.find(item => String(item.itemId?._id || item.itemId) === String(match._id) && !item.checked);
      if (existing) {
        await api.shoppingList.update(existing._id, { quantity: Number(existing.quantity || 1) + token.quantity });
      } else {
        await api.shoppingList.add({ itemId: match._id, quantity: token.quantity });
      }
      added += 1;
    }

    if (input) input.value = '';
    await loadShoppingListTab();
    if (missing.length) {
      showToast(`Added ${added}. Couldn’t match: ${missing.join(', ')}`, 4500);
    } else {
      showToast(`Added ${added} item${added === 1 ? '' : 's'}`);
    }
  } catch (err) {
    handleError(err, 'Failed to add items');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Add'; }
  }
}

function expectedCartEntry(item) {
  const quantity = Number(item.quantity || 1);
  const knownPrice = item.bestPrice
    ? (item.bestPrice.finalPrice != null
      ? Number(item.bestPrice.finalPrice)
      : Number(item.bestPrice.pricePerUnit || 0) * quantity)
    : null;
  const preferredStoreId = item.storeId?._id || item.storeId || null;
  const bestStoreId = item.bestPrice?.store?._id || null;
  return {
    name: item.itemId?.name || 'Unknown item',
    price: knownPrice != null && Number.isFinite(knownPrice) ? knownPrice : 0,
    quantity,
    storeId: preferredStoreId || bestStoreId,
    needsPrice: knownPrice == null || !Number.isFinite(knownPrice),
    priceSource: knownPrice == null ? 'missing' : 'expected'
  };
}

function installInstantCheckoff() {
  if (window._instantCheckoffInstalled) return;
  window._instantCheckoffInstalled = true;

  window.handleListItemCheck = function instantListItemCheck(id, willBeChecked) {
    if (pendingCheckIds.has(id)) return;
    const item = listState.items.find(entry => entry._id === id);
    if (!item) return;

    if (!willBeChecked) {
      cartState.delete(id);
      toggleListItem(id, false);
      return;
    }

    cartState.set(id, expectedCartEntry(item));
    toggleListItem(id, true);
  };

  const baseRenderShoppingList = window.renderShoppingList;
  if (typeof baseRenderShoppingList === 'function') {
    window.renderShoppingList = function renderShoppingListWithPriceNeeds() {
      baseRenderShoppingList();
      cartState.forEach((entry, id) => {
        if (!entry.needsPrice) return;
        const card = document.querySelector(`.list-item[data-id="${CSS.escape(String(id))}"]`);
        const priceLine = card?.querySelector('.card-subtitle.text-success');
        if (priceLine) {
          priceLine.textContent = 'In cart · price needed at checkout';
          priceLine.classList.remove('text-success');
          priceLine.classList.add('text-muted');
        }
      });
    };
  }

  window.renderCartDetail = function renderCartDetailWithNeeds(container) {
    let total = 0;
    const rows = [];
    cartState.forEach(entry => {
      total += Number(entry.price || 0);
      rows.push(`<div class="cart-detail-row">
        <span>${escapeHtml(entry.name)}</span>
        <span>${entry.needsPrice ? '<span class="trip-review-missing">Needs price</span>' : formatCurrency(entry.price)}</span>
      </div>`);
    });
    rows.push(`<div class="cart-detail-row cart-detail-total"><span>Estimated total</span><span>${formatCurrency(total)}</span></div>`);
    container.innerHTML = rows.join('');
  };
}

function tripStoreOptions(selectedStoreId) {
  const stores = listState.stores || [];
  return `<option value="">Choose store…</option>${stores.map(store =>
    `<option value="${escapeAttr(store._id)}"${String(store._id) === String(selectedStoreId || '') ? ' selected' : ''}>${escapeHtml(store.name)}</option>`
  ).join('')}`;
}

function openDoneShoppingReview() {
  const checkedItems = listState.items.filter(item => item.checked);
  if (!checkedItems.length) { showToast('No items checked off'); return; }

  const rows = checkedItems.map(item => {
    const cart = cartState.get(item._id) || expectedCartEntry(item);
    const priceValue = cart.needsPrice ? '' : Number(cart.price || 0).toFixed(2);
    return `
      <div class="trip-review-row" data-trip-item="${escapeAttr(item._id)}" data-original-price="${escapeAttr(priceValue)}">
        <div class="trip-review-title">
          <span>${escapeHtml(item.itemId?.name || 'Unknown item')}</span>
          <span class="text-muted text-sm">qty ${escapeHtml(item.quantity || 1)}</span>
        </div>
        ${cart.needsPrice ? '<div class="trip-review-missing" style="margin-bottom:0.35rem">Price needed</div>' : ''}
        <div class="trip-review-fields">
          <input class="form-control trip-price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Price" value="${escapeAttr(priceValue)}" />
          <select class="form-control trip-store">${tripStoreOptions(cart.storeId)}</select>
        </div>
      </div>`;
  }).join('');

  openModal('Done Shopping', `
    <p class="text-muted text-sm" style="margin-bottom:0.75rem">Review exceptions once, then finish the whole trip. Known prices are prefilled and can be corrected here.</p>
    <form id="complete-trip-form">
      <div class="trip-review-list">${rows}</div>
      <div class="checkbox-row" style="margin-top:0.8rem">
        <input type="checkbox" id="trip-update-pantry" checked />
        <label for="trip-update-pantry">Add purchased quantities to Pantry</label>
      </div>
      <div class="trip-total-row"><span>Trip total</span><span id="trip-review-total">$0.00</span></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Keep Shopping</button>
        <button type="submit" class="btn btn-primary">Finish Trip</button>
      </div>
    </form>`);

  const recalc = () => {
    let total = 0;
    document.querySelectorAll('.trip-price').forEach(input => {
      const value = Number(input.value);
      if (Number.isFinite(value) && value >= 0) total += value;
    });
    const totalEl = document.getElementById('trip-review-total');
    if (totalEl) totalEl.textContent = formatCurrency(total);
  };
  document.querySelectorAll('.trip-price').forEach(input => input.addEventListener('input', recalc));
  recalc();

  document.getElementById('complete-trip-form').addEventListener('submit', async event => {
    event.preventDefault();
    const payloadItems = [];
    let missingDetails = 0;

    document.querySelectorAll('[data-trip-item]').forEach(row => {
      const listItemId = row.dataset.tripItem;
      const priceInput = row.querySelector('.trip-price');
      const storeSelect = row.querySelector('.trip-store');
      const originalPrice = row.dataset.originalPrice;
      const price = priceInput.value === '' ? null : Number(priceInput.value);
      const storeId = storeSelect.value || null;
      if (price === null || !storeId) missingDetails += 1;
      payloadItems.push({
        listItemId,
        price,
        storeId,
        priceSource: originalPrice !== '' && price !== null && Math.abs(Number(originalPrice) - price) < 0.005 ? 'expected' : 'manual'
      });
    });

    if (missingDetails && listState.stores.length) {
      showToast(`Finish the ${missingDetails} missing price/store detail${missingDetails === 1 ? '' : 's'} first`, 3500);
      return;
    }

    const submit = event.target.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Finishing…';
    try {
      const summary = await api.shoppingList.completeTrip({
        date: productLocalDateValue(),
        updatePantry: document.getElementById('trip-update-pantry').checked,
        items: payloadItems
      });
      checkedItems.forEach(item => cartState.delete(item._id));
      closeModal();
      await loadShoppingListTab();
      if (document.getElementById('tab-home')?.classList.contains('active')) await loadHomeTab();

      const priceNote = summary.needsPriceReviewCount
        ? ` · ${summary.needsPriceReviewCount} price${summary.needsPriceReviewCount === 1 ? '' : 's'} not recorded`
        : '';
      showToast(`Trip complete · ${summary.purchasedCount} items · ${formatCurrency(summary.tripTotal)}${priceNote}`, 5000);
    } catch (err) {
      handleError(err, 'Failed to finish shopping trip');
      submit.disabled = false;
      submit.textContent = 'Finish Trip';
    }
  });
}

function initShoppingLoopEnhancements() {
  installInstantCheckoff();
  const button = document.getElementById('btn-done-shopping');
  if (button && !button.dataset.loopEnhanced) {
    button.dataset.loopEnhanced = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openDoneShoppingReview();
    }, true);
  }
}
