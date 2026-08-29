// Home / Today dashboard. Each card owns its loading/error state so one failed
// endpoint never replaces the entire dashboard.

const homeState = {
  shoppingList: null,
  lowStock: null,
  plan: null,
  settings: null,
  deferredPrices: [],
  status: { shoppingList: 'loading', lowStock: 'loading', plan: 'loading' }
};

function homeEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function homeIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function homeWeekStart(date, weekStartDay) {
  const copy = new Date(date);
  let offset = copy.getDay() - weekStartDay;
  if (offset < 0) offset += 7;
  copy.setDate(copy.getDate() - offset);
  return homeIsoDate(copy);
}

function homeCacheKey(source) {
  const householdId = window.appAuth?.user?.householdId || 'household';
  return `provista_home_${householdId}_${source}`;
}

function readHomeCache(source) {
  try {
    const cached = JSON.parse(localStorage.getItem(homeCacheKey(source)) || 'null');
    return cached?.data ?? null;
  } catch (_) {
    return null;
  }
}

function writeHomeCache(source, data) {
  try {
    localStorage.setItem(homeCacheKey(source), JSON.stringify({ savedAt: new Date().toISOString(), data }));
  } catch (_) {}
}

function homeItemName(item) {
  return item?.itemId?.name || item?.name || 'Item';
}

function homeSummaryList(items, emptyText) {
  if (!items.length) return `<p class="home-card-empty">${homeEscape(emptyText)}</p>`;
  return `<ul>${items.slice(0, 3).map(item => `<li>${homeEscape(homeItemName(item))}</li>`).join('')}</ul>`;
}

function homeCard({ question, title, detail, items = [], emptyText, action, tab, actionType, tone = '', status = 'fresh' }) {
  if (status === 'loading') {
    return `<article class="home-card ${tone}" aria-busy="true">
      <p class="home-question">${homeEscape(question)}</p>
      <div class="home-card-skeleton" aria-label="Loading"></div>
    </article>`;
  }
  const unavailable = status === 'error';
  return `
    <article class="home-card ${tone}">
      <div class="home-card-question-row">
        <p class="home-question">${homeEscape(question)}</p>
        ${status === 'stale' ? '<span class="home-stale-badge">Saved view</span>' : ''}
      </div>
      <h2>${homeEscape(unavailable ? 'Couldn’t load this update' : title)}</h2>
      ${detail || unavailable ? `<p class="home-card-detail">${homeEscape(unavailable ? 'The rest of Home is still available.' : detail)}</p>` : ''}
      ${unavailable ? '' : homeSummaryList(items, emptyText)}
      <button class="home-card-action" ${unavailable ? 'data-home-retry="true"' : (actionType ? `data-home-action="${homeEscape(actionType)}"` : `data-home-tab="${homeEscape(tab)}"`)}>
        ${homeEscape(unavailable ? 'Try again' : action)} →
      </button>
    </article>`;
}

function deferredPriceCard() {
  const count = homeState.deferredPrices.length;
  if (!count) return '';
  return `
    <article class="home-card home-price-review-card" id="home-price-review-card">
      <p class="home-question">Anything to finish?</p>
      <h2>${count} price${count === 1 ? '' : 's'} to review</h2>
      <p class="home-card-detail">These are prices you chose to update later. Saving them updates Spending automatically.</p>
      <button class="home-card-action" id="home-review-prices">Review prices →</button>
    </article>`;
}

function renderHome() {
  const container = document.getElementById('home-content');
  if (!container) return;

  const today = homeIsoDate();
  const plan = homeState.plan;
  const shoppingList = homeState.shoppingList;
  const lowStock = homeState.lowStock;
  const todayPlan = (plan?.days || []).find(day => String(day.date || '').slice(0, 10) === today);
  const dinners = (todayPlan?.meals || []).filter(meal => meal.mealType === 'dinner' && meal.name?.trim());
  const needed = (shoppingList || []).filter(item => !item.checked);
  const deferredCount = homeState.deferredPrices.length;

  let next = {
    title: 'You’re caught up',
    detail: 'Nothing urgent needs your attention.',
    action: 'Open your plan',
    tab: 'meal-plan'
  };
  if (homeState.status.plan !== 'error' && plan && !dinners.length) {
    next = { title: 'Plan tonight’s dinner', detail: 'One choice can shape the rest of the week.', action: 'Plan dinner', actionType: 'plan-dinner' };
  } else if (deferredCount) {
    next = {
      title: `Finish ${deferredCount} shopping price${deferredCount === 1 ? '' : 's'}`,
      detail: 'You chose to review these later.',
      action: 'Review prices',
      actionType: 'review-prices'
    };
  } else if (Array.isArray(lowStock) && lowStock.length) {
    next = { title: 'Review low and out staples', detail: `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} need attention.`, action: 'Open Pantry', tab: 'inventory' };
  } else if (Array.isArray(shoppingList) && needed.length) {
    next = { title: 'Review the shopping list', detail: `${needed.length} item${needed.length === 1 ? '' : 's'} left to get.`, action: 'Open list', tab: 'list' };
  }

  const nextStatus = Object.values(homeState.status).every(status => status === 'loading')
    ? 'loading'
    : (Object.values(homeState.status).some(status => status === 'stale') ? 'stale' : 'fresh');

  const cards = [
    homeCard({
      question: 'What’s for dinner?',
      title: dinners.length ? dinners.map(meal => meal.name).join(' · ') : 'Dinner isn’t planned yet',
      emptyText: dinners.length ? 'Tonight’s plan is ready.' : 'Choose a meal in a few taps.',
      action: dinners.length ? 'View tonight' : 'Plan dinner',
      actionType: 'plan-dinner',
      tone: 'home-card-featured',
      status: homeState.status.plan
    }),
    homeCard({
      question: 'What do we need?',
      title: needed.length ? `${needed.length} item${needed.length === 1 ? '' : 's'} on the list` : 'The list is clear',
      items: needed,
      emptyText: 'Add an item whenever it comes to mind.',
      action: needed.length ? 'Open list' : 'Quick add',
      tab: needed.length ? 'list' : undefined,
      actionType: needed.length ? undefined : 'quick-add',
      status: homeState.status.shoppingList
    }),
    homeCard({
      question: 'Is anything running low?',
      title: lowStock?.length ? `${lowStock.length} low or out item${lowStock.length === 1 ? '' : 's'}` : 'Pantry looks good',
      items: lowStock || [],
      emptyText: 'No tracked staples are marked low or out.',
      action: 'Open Pantry',
      tab: 'inventory',
      status: homeState.status.lowStock
    }),
    deferredPriceCard(),
    homeCard({
      question: 'What should I do next?',
      ...next,
      emptyText: '',
      tone: 'home-card-next',
      status: nextStatus
    })
  ].filter(Boolean);

  container.innerHTML = cards.join('');

  container.querySelectorAll('[data-home-tab]').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.homeTab));
  });
  container.querySelectorAll('[data-home-action="plan-dinner"]').forEach(button => {
    button.addEventListener('click', openTodaysDinner);
  });
  container.querySelectorAll('[data-home-action="quick-add"]').forEach(button => {
    button.addEventListener('click', openHomeQuickAdd);
  });
  container.querySelectorAll('[data-home-action="review-prices"]').forEach(button => {
    button.addEventListener('click', openDeferredPriceReview);
  });
  container.querySelectorAll('[data-home-retry]').forEach(button => {
    button.addEventListener('click', loadHomeTab, { once: true });
  });
  document.getElementById('home-review-prices')?.addEventListener('click', openDeferredPriceReview);

  const dot = document.getElementById('nav-pending-dot');
  if (dot) dot.style.display = homeState.deferredPrices.length ? '' : 'none';
}

function restoreHomeCache() {
  ['shoppingList', 'lowStock', 'plan', 'settings'].forEach(source => {
    const cached = readHomeCache(source);
    if (cached !== null) {
      homeState[source] = cached;
      if (source !== 'settings') homeState.status[source] = 'stale';
    } else if (source !== 'settings') {
      homeState.status[source] = 'loading';
      homeState[source] = null;
    }
  });
}

async function loadHomeSource(source, request) {
  try {
    const data = await request();
    homeState[source] = data;
    homeState.status[source] = 'fresh';
    writeHomeCache(source, data);
  } catch (_) {
    homeState.status[source] = homeState[source] === null ? 'error' : 'stale';
  }
  renderHome();
}

async function loadDeferredPrices() {
  try {
    homeState.deferredPrices = await api.shoppingTrips.deferredPrices();
  } catch (_) {
    homeState.deferredPrices = [];
  }
  renderHome();
  return homeState.deferredPrices;
}

async function loadHomeTab() {
  const container = document.getElementById('home-content');
  if (!container) return;

  const user = window.appAuth?.user;
  const userName = user?.displayName?.trim() || user?.name?.trim().split(/\s+/)[0] || '';
  const greeting = document.getElementById('home-greeting');
  const date = document.getElementById('home-date');
  if (greeting) greeting.textContent = userName ? `Hi, ${userName}` : 'Today';
  if (date) date.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  restoreHomeCache();
  renderHome();

  const settingsPromise = api.get('/meal-plan/settings')
    .then(settings => {
      homeState.settings = settings;
      writeHomeCache('settings', settings);
      return settings;
    })
    .catch(() => homeState.settings || { weekStartDay: 6 });

  const shoppingPromise = loadHomeSource('shoppingList', () => api.shoppingList.list());
  const lowStockPromise = loadHomeSource('lowStock', () => api.get('/inventory/low-stock'));
  const planPromise = loadHomeSource('plan', async () => {
    const settings = await settingsPromise;
    const weekStart = homeWeekStart(new Date(), settings.weekStartDay ?? 6);
    return api.get(`/meal-plan?weekStart=${encodeURIComponent(weekStart)}`);
  });
  const deferredPromise = loadDeferredPrices();
  await Promise.allSettled([shoppingPromise, lowStockPromise, planPromise, deferredPromise]);
}

async function openTodaysDinner() {
  await switchTab('meal-plan');
  if (typeof focusTodaysDinner === 'function') focusTodaysDinner();
}

async function openHomeQuickAdd() {
  await switchTab('list');
  const rapidInput = document.getElementById('rapid-list-input');
  if (rapidInput) {
    rapidInput.focus({ preventScroll: true });
    rapidInput.scrollIntoView({ block: 'nearest' });
  }
}

async function openDeferredPriceReview() {
  await loadDeferredPrices();
  if (!homeState.deferredPrices.length) return showToast('No prices need review');

  openModal('Review prices', `
    <p class="text-muted text-sm">Add only the prices you know now. Anything left blank stays here for later.</p>
    <div class="deferred-price-list">
      ${homeState.deferredPrices.map((item, index) => `
        <label class="deferred-price-row">
          <span><strong>${escapeHtml(item.itemName)}</strong><small>${escapeHtml(item.storeName || 'Store')} · ${escapeHtml(new Date(item.completedAt).toLocaleDateString())}</small></span>
          <span class="deferred-price-input-wrap"><span>$</span><input class="form-control deferred-price-input" type="number" min="0" step="0.01" inputmode="decimal" data-index="${index}" placeholder="0.00" /></span>
        </label>`).join('')}
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-outline" onclick="closeModal()">Done for now</button>
      <button type="button" class="btn btn-primary" id="save-deferred-prices">Save entered prices</button>
    </div>`);

  document.getElementById('save-deferred-prices')?.addEventListener('click', saveDeferredPrices);
}

async function saveDeferredPrices() {
  const button = document.getElementById('save-deferred-prices');
  const updates = [...document.querySelectorAll('.deferred-price-input')]
    .map(input => ({ input, item: homeState.deferredPrices[Number(input.dataset.index)], raw: input.value.trim() }))
    .filter(entry => entry.raw !== '');
  if (!updates.length) return showToast('Enter at least one price, or choose Done for now');

  for (const update of updates) {
    const value = Number(update.raw);
    if (!Number.isFinite(value) || value < 0) {
      showToast(`Enter a valid price for ${update.item.itemName}`);
      update.input.focus();
      return;
    }
  }

  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  const results = await Promise.allSettled(updates.map(update => api.shoppingTrips.resolvePrice(
    update.item.tripId,
    update.item.shoppingListItemId,
    { price: Number(update.raw), storeId: update.item.storeId }
  )));
  const saved = results.filter(result => result.status === 'fulfilled').length;
  const failed = results.length - saved;

  closeModal();
  await loadDeferredPrices();
  showToast(failed
    ? `${saved} price${saved === 1 ? '' : 's'} saved · ${failed} could not be updated`
    : `${saved} price${saved === 1 ? '' : 's'} saved · Spending updated`, 5000);
}

function initHomeTab() {
  document.getElementById('home-quick-add')?.addEventListener('click', openHomeQuickAdd);
  document.getElementById('home-plan-dinner')?.addEventListener('click', openTodaysDinner);
}
