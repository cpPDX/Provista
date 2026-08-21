// Home / Today dashboard

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

function homeItemName(item) {
  return item?.itemId?.name || item?.name || 'Item';
}

function homeSummaryList(items, emptyText) {
  if (!items.length) return `<p class="home-card-empty">${homeEscape(emptyText)}</p>`;
  return `<ul>${items.slice(0, 3).map(item => `<li>${homeEscape(homeItemName(item))}</li>`).join('')}</ul>`;
}

function homeCard({ question, title, detail, items = [], emptyText, action, tab, tone = '' }) {
  return `
    <article class="home-card ${tone}">
      <p class="home-question">${homeEscape(question)}</p>
      <h2>${homeEscape(title)}</h2>
      ${detail ? `<p class="home-card-detail">${homeEscape(detail)}</p>` : ''}
      ${homeSummaryList(items, emptyText)}
      <button class="home-card-action" data-home-tab="${homeEscape(tab)}">${homeEscape(action)} →</button>
    </article>`;
}

async function fetchHomeData() {
  const settings = await api.get('/meal-plan/settings');
  const weekStart = homeWeekStart(new Date(), settings.weekStartDay ?? 6);
  const [shoppingList, lowStock, plan] = await Promise.all([
    api.shoppingList.list(),
    api.get('/inventory/low-stock'),
    api.get(`/meal-plan?weekStart=${encodeURIComponent(weekStart)}`)
  ]);
  return { shoppingList, lowStock, plan };
}

function renderHome({ shoppingList, lowStock, plan }) {
  const container = document.getElementById('home-content');
  if (!container) return;

  const today = homeIsoDate();
  const todayPlan = (plan.days || []).find(day => String(day.date || '').slice(0, 10) === today);
  const dinners = (todayPlan?.meals || []).filter(meal => meal.mealType === 'dinner' && meal.name?.trim());
  const needed = (shoppingList || []).filter(item => !item.checked);
  const dinnerItems = dinners.map(meal => ({ name: meal.name }));

  let next = {
    title: 'You’re caught up',
    detail: 'Nothing urgent needs your attention.',
    action: 'Open your plan',
    tab: 'meal-plan'
  };
  if (!dinners.length) {
    next = { title: 'Plan tonight’s dinner', detail: 'One choice can shape the rest of the week.', action: 'Plan dinner', tab: 'meal-plan' };
  } else if (lowStock.length) {
    next = { title: 'Review low-stock staples', detail: `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} may need attention.`, action: 'Open Pantry', tab: 'inventory' };
  } else if (needed.length) {
    next = { title: 'Review the shopping list', detail: `${needed.length} item${needed.length === 1 ? '' : 's'} left to get.`, action: 'Open list', tab: 'list' };
  }

  container.innerHTML = [
    homeCard({
      question: 'What’s for dinner?',
      title: dinners.length ? dinners.map(meal => meal.name).join(' · ') : 'Dinner isn’t planned yet',
      items: [],
      emptyText: dinners.length ? 'Tonight’s plan is ready.' : 'Choose a meal in a few taps.',
      action: dinners.length ? 'View plan' : 'Plan dinner',
      tab: 'meal-plan',
      tone: 'home-card-featured'
    }),
    homeCard({
      question: 'What do we need?',
      title: needed.length ? `${needed.length} item${needed.length === 1 ? '' : 's'} on the list` : 'The list is clear',
      items: needed,
      emptyText: 'Add an item whenever it comes to mind.',
      action: needed.length ? 'Open list' : 'Quick add',
      tab: 'list'
    }),
    homeCard({
      question: 'Is anything running low?',
      title: lowStock.length ? `${lowStock.length} low-stock item${lowStock.length === 1 ? '' : 's'}` : 'Pantry looks good',
      items: lowStock,
      emptyText: 'No tracked staples are below their alert level.',
      action: 'Open Pantry',
      tab: 'inventory'
    }),
    homeCard({
      question: 'What should I do next?',
      title: next.title,
      detail: next.detail,
      items: [],
      emptyText: '',
      action: next.action,
      tab: next.tab,
      tone: 'home-card-next'
    })
  ].join('');

  container.querySelectorAll('[data-home-tab]').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.homeTab));
  });
}

async function loadHomeTab() {
  const container = document.getElementById('home-content');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

  const userName = window.appAuth?.user?.name?.trim().split(/\s+/)[0] || '';
  const greeting = document.getElementById('home-greeting');
  const date = document.getElementById('home-date');
  if (greeting) greeting.textContent = userName ? `Hi, ${userName}` : 'Today';
  if (date) date.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  try {
    renderHome(await fetchHomeData());
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⌂</div>
        <p>We couldn’t load today’s household summary.</p>
        <button class="btn btn-outline btn-sm" id="home-retry">Try again</button>
      </div>`;
    document.getElementById('home-retry')?.addEventListener('click', loadHomeTab);
  }
}

function initHomeTab() {
  document.getElementById('home-quick-add')?.addEventListener('click', async () => {
    await switchTab('list');
    document.getElementById('btn-add-list-item')?.click();
  });
  document.getElementById('home-plan-dinner')?.addEventListener('click', () => switchTab('meal-plan'));
}
