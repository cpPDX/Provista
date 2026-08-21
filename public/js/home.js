// Home / Today dashboard. Each card owns its loading/error state so one failed
// endpoint never replaces the entire dashboard.

const homeState = {
  shoppingList: null,
  lowStock: null,
  plan: null,
  settings: null,
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

  let next = {
    title: 'You’re caught up',
    detail: 'Nothing urgent needs your attention.',
    action: 'Open your plan',
    tab: 'meal-plan'
  };
  if (homeState.status.plan !== 'error' && plan && !dinners.length) {
    next = { title: 'Plan tonight’s dinner', detail: 'One choice can shape the rest of the week.', action: 'Plan dinner', actionType: 'plan-dinner' };
  } else if (Array.isArray(lowStock) && lowStock.length) {
    next = { title: 'Review low and out staples', detail: `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} need attention.`, action: 'Open Pantry', tab: 'inventory' };
  } else if (Array.isArray(shoppingList) && needed.length) {
    next = { title: 'Review the shopping list', detail: `${needed.length} item${needed.length === 1 ? '' : 's'} left to get.`, action: 'Open list', tab: 'list' };
  }

  const nextStatus = Object.values(homeState.status).every(status => status === 'loading')
    ? 'loading'
    : (Object.values(homeState.status).some(status => status === 'stale') ? 'stale' : 'fresh');
  container.innerHTML = [
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
      tab: 'list',
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
    homeCard({
      question: 'What should I do next?',
      ...next,
      emptyText: '',
      tone: 'home-card-next',
      status: nextStatus
    })
  ].join('');

  container.querySelectorAll('[data-home-tab]').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.homeTab));
  });
  container.querySelectorAll('[data-home-action="plan-dinner"]').forEach(button => {
    button.addEventListener('click', openTodaysDinner);
  });
  container.querySelectorAll('[data-home-retry]').forEach(button => {
    button.addEventListener('click', loadHomeTab, { once: true });
  });
}

function restoreHomeCache() {
  ['shoppingList', 'lowStock', 'plan', 'settings'].forEach(source => {
    const cached = readHomeCache(source);
    if (cached !== null) {
      homeState[source] = cached;
      if (source !== 'settings') homeState.status[source] = 'stale';
    } else if (source !== 'settings') {
      homeState.status[source] = 'loading';
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

async function loadHomeTab() {
  const container = document.getElementById('home-content');
  if (!container) return;

  const userName = window.appAuth?.user?.name?.trim().split(/\s+/)[0] || '';
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
  await Promise.allSettled([shoppingPromise, lowStockPromise, planPromise]);
}

async function openTodaysDinner() {
  await switchTab('meal-plan');
  if (typeof focusTodaysDinner === 'function') focusTodaysDinner();
}

function initHomeTab() {
  document.getElementById('home-quick-add')?.addEventListener('click', async () => {
    await switchTab('list');
    document.getElementById('btn-add-list-item')?.click();
  });
  document.getElementById('home-plan-dinner')?.addEventListener('click', openTodaysDinner);
}
