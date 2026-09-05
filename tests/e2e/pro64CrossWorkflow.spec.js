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

function dinnerFor(days, dayIndex) {
  return days[dayIndex].meals.find(meal => meal.mealType === 'dinner');
}

async function createProduct(page, name, category = 'Pantry') {
  const response = await page.request.post('/api/items', {
    data: { name, category, unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createExactPantry(page, item, quantity) {
  const response = await page.request.post('/api/inventory', {
    data: { itemId: item._id, trackingMode: 'exact', quantity, lowStockThreshold: 1, unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
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

async function projection(page, weekStart) {
  const response = await page.request.get(`/api/inventory/meal-projection?weekStart=${weekStart}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

function summaryFor(result, item) {
  return result.itemSummaries.find(summary => String(summary.itemId) === String(item._id));
}

test.describe('PRO-64 cross-workflow state integrity', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    expect((await page.request.delete('/api/shopping-list')).ok()).toBeTruthy();
  });

  test('keeps fractional availability, cumulative shortage, List provenance, and replanning in sync', async ({ page }) => {
    const todayIndex = new Date().getDay();
    test.skip(todayIndex >= 6, 'This current-week scenario needs today plus a later day.');

    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const weekStart = currentWeekStart();
    const onion = await createProduct(page, `PRO64 Onion ${suffix}`, 'Produce');
    const beans = await createProduct(page, `PRO64 Beans ${suffix}`);
    await createExactPantry(page, onion, 1);
    await createExactPantry(page, beans, 4);

    const days = blankWeek(weekStart);
    Object.assign(dinnerFor(days, todayIndex), {
      name: 'First dinner',
      notes: `0.25 ${onion.name}, 2 ${beans.name}`
    });
    Object.assign(dinnerFor(days, todayIndex + 1), {
      name: 'Later dinner',
      notes: `3 ${beans.name}`
    });
    await savePlan(page, weekStart, days);

    let result = await projection(page, weekStart);
    const onionSummary = summaryFor(result, onion);
    const beansSummary = summaryFor(result, beans);
    expect(onionSummary.plannedQuantity).toBeCloseTo(0.25, 5);
    expect(onionSummary.projectedQuantity).toBeCloseTo(0.75, 5);
    expect(onionSummary.shortageQuantity).toBe(0);
    expect(beansSummary.onHandQuantity).toBe(4);
    expect(beansSummary.plannedQuantity).toBe(5);
    expect(beansSummary.shortageQuantity).toBe(1);
    expect(beansSummary.shoppingQuantity).toBe(1);

    const listResponse = await page.request.post('/api/shopping-list', {
      data: { itemId: beans._id, quantity: 1 }
    });
    expect(listResponse.ok()).toBeTruthy();
    const listItem = await listResponse.json();

    await page.goto('/app/list');
    const card = page.locator(`.react-list-item[data-id="${listItem._id}"]`);
    const todayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date());
    await expect(card).toContainText(`Needed ${todayLabel} · First dinner · 2 meals`);

    Object.assign(dinnerFor(days, todayIndex + 1), { name: '', notes: '' });
    await savePlan(page, weekStart, days);
    await page.reload();
    await expect(card).toContainText(`Needed ${todayLabel} · First dinner`);
    await expect(card).not.toContainText('Later dinner');
    await expect(card).not.toContainText('2 meals');

    result = await projection(page, weekStart);
    const replannedBeans = summaryFor(result, beans);
    expect(replannedBeans.plannedQuantity).toBe(2);
    expect(replannedBeans.projectedQuantity).toBe(2);
    expect(replannedBeans.shortageQuantity).toBe(0);
  });

  test('shopping completion updates actual Pantry without corrupting future allocation math', async ({ page }) => {
    const todayIndex = new Date().getDay();
    test.skip(todayIndex >= 6, 'This current-week scenario needs a future day.');

    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const weekStart = currentWeekStart();
    const item = await createProduct(page, `PRO64 Future Rice ${suffix}`);
    const pantry = await createExactPantry(page, item, 1);
    const days = blankWeek(weekStart);
    Object.assign(dinnerFor(days, todayIndex + 1), {
      name: 'Future dinner',
      notes: `2 ${item.name}`
    });
    await savePlan(page, weekStart, days);

    let result = await projection(page, weekStart);
    expect(summaryFor(result, item).shortageQuantity).toBe(1);

    const storeResponse = await page.request.post('/api/stores', { data: { name: `PRO64 Store ${suffix}` } });
    expect(storeResponse.ok()).toBeTruthy();
    const store = await storeResponse.json();
    const listResponse = await page.request.post('/api/shopping-list', {
      data: { itemId: item._id, quantity: 1, storeId: store._id }
    });
    expect(listResponse.ok()).toBeTruthy();
    const listItem = await listResponse.json();
    const checked = await page.request.put(`/api/shopping-list/${listItem._id}`, {
      data: { checked: true, shoppingStoreId: store._id, actualPurchasedQuantity: 1 }
    });
    expect(checked.ok()).toBeTruthy();

    const complete = await page.request.post('/api/shopping-list/complete', {
      data: {
        idempotencyKey: `pro64-${suffix}`,
        purchases: [{ listItemId: listItem._id, price: null, storeId: store._id }],
        addToPantry: true
      }
    });
    expect(complete.ok()).toBeTruthy();
    const completion = await complete.json();
    expect(completion.pantryUpdated).toBe(true);

    const inventoryResponse = await page.request.get('/api/inventory');
    expect(inventoryResponse.ok()).toBeTruthy();
    const inventory = await inventoryResponse.json();
    const updated = inventory.find(entry => String(entry._id) === String(pantry._id));
    expect(updated.quantity).toBe(2);

    result = await projection(page, weekStart);
    const afterShopping = summaryFor(result, item);
    expect(afterShopping.onHandQuantity).toBe(2);
    expect(afterShopping.plannedQuantity).toBe(2);
    expect(afterShopping.shortageQuantity).toBe(0);
    expect(afterShopping.projectedQuantity).toBe(0);
  });

  test('keeps separate household planning context selected across a Plan to List round trip', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const personResponse = await page.request.post('/api/household/people', {
      data: { displayName: `PRO64 Planner ${suffix}` }
    });
    expect(personResponse.ok()).toBeTruthy();

    await page.goto('/app/plan');
    const meal = page.locator('.plan-focused-day input[data-meal-name]').first();
    await meal.fill(`Shared ${suffix}`);
    await page.getByRole('button', { name: '+ Separate group' }).click();
    await page.locator('.plan-focused-day input[data-meal-name]').first().fill(`Separate ${suffix}`);
    await expect(page.locator('.plan-save-status')).toContainText('Saved', { timeout: 8000 });

    const groups = page.locator('.plan-audience-status-list button').filter({ hasNotText: '+ Separate group' });
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(1)).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    const restoredGroups = page.locator('.plan-audience-status-list button').filter({ hasNotText: '+ Separate group' });
    await expect(restoredGroups).toHaveCount(2);
    await expect(restoredGroups.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.plan-focused-day input[data-meal-name]').first()).toHaveValue(`Separate ${suffix}`);
  });

  test('keeps Produce planning and Pantry on the same product identity', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const product = await createProduct(page, `PRO64 Kale ${suffix}`, 'Produce');

    await page.goto('/app/plan');
    const produceView = page.getByRole('region', { name: 'Produce to use this week' });
    await produceView.getByLabel('Add produce you already have').fill(product.name);
    await produceView.getByRole('button', { name: 'Add to Pantry' }).click();
    await expect(produceView).toContainText(product.name);

    const inventoryResponse = await page.request.get('/api/inventory');
    expect(inventoryResponse.ok()).toBeTruthy();
    const inventory = await inventoryResponse.json();
    const matching = inventory.filter(entry => String(entry.itemId?._id || entry.itemId) === String(product._id));
    expect(matching).toHaveLength(1);

    const pantryItem = matching[0];
    const update = await page.request.put(`/api/inventory/${pantryItem._id}`, {
      data: { trackingMode: 'simple', stockStatus: 'out' }
    });
    expect(update.ok()).toBeTruthy();
    await page.reload();
    await expect(produceView).toContainText(product.name);
    await expect(produceView).toContainText('Out');
  });
});
