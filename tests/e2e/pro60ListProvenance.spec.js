const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'special'];

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentWeekStart() {
  const date = new Date();
  date.setDate(date.getDate() - date.getDay());
  return dateKey(date);
}

function addDays(value, amount) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function blankWeek(weekStart) {
  return Array.from({ length: 7 }, (_, dayIndex) => ({
    date: `${addDays(weekStart, dayIndex)}T00:00:00.000Z`,
    specialCollapsed: true,
    meals: MEAL_TYPES.map(mealType => ({
      mealType,
      personName: '',
      personIds: [],
      forEveryone: true,
      name: '',
      notes: ''
    }))
  }));
}

function setDinner(days, dayIndex, name, notes) {
  const dinner = days[dayIndex].meals.find(meal => meal.mealType === 'dinner');
  dinner.name = name;
  dinner.notes = notes;
}

async function savePlan(page, weekStart, days) {
  const settings = await page.request.put('/api/meal-plan/settings', {
    data: { weekStartDay: 0, mealPlanMode: 'dinner' }
  });
  expect(settings.ok()).toBeTruthy();
  const response = await page.request.put('/api/meal-plan', {
    data: { weekStart, days, produceNotes: '', shoppingNotes: '' }
  });
  expect(response.ok()).toBeTruthy();
}

test.describe('PRO-60 List meal provenance', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    expect((await page.request.delete('/api/shopping-list')).ok()).toBeTruthy();
  });

  test('shows the earliest current-week need and removes stale meal context after replanning', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const weekStart = currentWeekStart();
    const todayIndex = new Date().getDay();
    test.skip(todayIndex >= 6, 'This scenario needs today plus a later day in the current week.');

    const itemName = `PRO60 Broccoli ${suffix}`;
    const itemResponse = await page.request.post('/api/items', {
      data: { name: itemName, category: 'Produce', unit: 'head' }
    });
    expect(itemResponse.ok()).toBeTruthy();
    const item = await itemResponse.json();

    const listResponse = await page.request.post('/api/shopping-list', {
      data: { itemId: item._id, quantity: 2 }
    });
    expect(listResponse.ok()).toBeTruthy();
    const listItem = await listResponse.json();

    const days = blankWeek(weekStart);
    setDinner(days, todayIndex, 'Chicken Alfredo', itemName);
    setDinner(days, todayIndex + 1, 'Veggie bowls', itemName);
    await savePlan(page, weekStart, days);

    await page.goto('/app/list');
    const card = page.locator(`.react-list-item[data-id="${listItem._id}"]`);
    await expect(card).toBeVisible();
    const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date());
    await expect(card).toContainText(`Needed ${todayLabel} · Chicken Alfredo · 2 meals`);

    setDinner(days, todayIndex, '', '');
    await savePlan(page, weekStart, days);
    await page.reload();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(tomorrow);
    await expect(card).toContainText(`Needed ${tomorrowLabel} · Veggie bowls`);
    await expect(card).not.toContainText('Chicken Alfredo');
    await expect(card).not.toContainText('2 meals');
  });

  test('keeps manual List items free of Plan semantics', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const itemResponse = await page.request.post('/api/items', {
      data: { name: `PRO60 Manual ${suffix}`, category: 'Pantry', unit: 'each' }
    });
    expect(itemResponse.ok()).toBeTruthy();
    const item = await itemResponse.json();
    const listResponse = await page.request.post('/api/shopping-list', {
      data: { itemId: item._id, quantity: 3 }
    });
    expect(listResponse.ok()).toBeTruthy();
    const listItem = await listResponse.json();

    await page.goto('/app/list');
    const card = page.locator(`.react-list-item[data-id="${listItem._id}"]`);
    await expect(card).toContainText('Buy 3');
    await expect(card).not.toContainText('Needed ');
  });
});
