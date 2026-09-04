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

function addDays(dateString, amount) {
  const [year, month, day] = dateString.split('-').map(Number);
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

async function inventoryQuantity(page, itemId) {
  const response = await page.request.get('/api/inventory');
  expect(response.ok()).toBeTruthy();
  const items = await response.json();
  const entry = items.find(item => String(item.itemId?._id || item.itemId) === String(itemId));
  expect(entry).toBeTruthy();
  return Number(entry.quantity);
}

async function inventoryHistory(page, itemId) {
  const response = await page.request.get('/api/inventory/history');
  expect(response.ok()).toBeTruthy();
  const events = await response.json();
  return events.filter(event => String(event.itemId?._id || event.itemId) === String(itemId));
}

test.describe('PRO-76 reconciled Plan workflow', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
  });

  test('keeps stable meal identity while explicitly correcting and reversing Pantry usage', async ({ page }) => {
    const todayIndex = new Date().getDay();
    test.skip(todayIndex === 0, 'A past day in the current week is required for reconciliation coverage.');

    const weekStart = currentWeekStart();
    const pastDayIndex = todayIndex - 1;
    const pastDate = addDays(weekStart, pastDayIndex);
    const days = blankWeek(weekStart);
    const itemName = `PRO76 Chicken ${Date.now()}-${test.info().workerIndex}`;

    const itemResponse = await page.request.post('/api/items', {
      data: { name: itemName, category: 'Other', unit: 'each' }
    });
    expect(itemResponse.ok()).toBeTruthy();
    const item = await itemResponse.json();

    // This count is recorded now, after the historical meal's effective date.
    // It is therefore the newer assertion of physical truth and must continue
    // to win even as historical meal events are reconciled and corrected.
    const pantryResponse = await page.request.post('/api/inventory', {
      data: { itemId: item._id, trackingMode: 'exact', quantity: 4, unit: 'each' }
    });
    expect(pantryResponse.ok()).toBeTruthy();

    const dinner = days[pastDayIndex].meals.find(meal => meal.mealType === 'dinner');
    dinner.name = 'Reconciled dinner';
    dinner.notes = `${itemName} x2`;

    const settings = await page.request.put('/api/meal-plan/settings', {
      data: { weekStartDay: 0, mealPlanMode: 'dinner' }
    });
    expect(settings.ok()).toBeTruthy();
    const save = await page.request.put('/api/meal-plan', {
      data: { weekStart, days, produceNotes: '', shoppingNotes: '' }
    });
    expect(save.ok()).toBeTruthy();
    const seededPlan = await save.json();
    const initialInstanceId = seededPlan.days[pastDayIndex].meals.find(meal => meal.mealType === 'dinner').instanceId;
    expect(initialInstanceId).toBeTruthy();

    await page.evaluate(context => {
      sessionStorage.setItem('provista-plan-context', JSON.stringify(context));
    }, { weekStart, date: pastDate, mealType: 'dinner', rowIndex: 0 });

    await page.goto('/app/plan');
    await expect(page.getByText('Pantry already updated from this meal')).toBeVisible();
    expect(await inventoryQuantity(page, item._id)).toBe(4);

    let history = await inventoryHistory(page, item._id);
    const consumption = history.find(event => event.type === 'meal_consumption' && event.sourceMeta?.mealInstanceId === initialInstanceId);
    expect(consumption).toBeTruthy();
    expect(Number(consumption.quantityDelta)).toBe(-2);

    const needs = page.getByLabel('Need for this meal');
    await needs.fill(`${itemName} x1`);
    await page.getByRole('button', { name: 'Update Pantry too' }).click();
    await expect(page.getByText('Pantry updated for this meal.')).toBeVisible();
    expect(await inventoryQuantity(page, item._id)).toBe(4);

    history = await inventoryHistory(page, item._id);
    const correction = history.find(event => event.type === 'correction' && event.sourceMeta?.mealInstanceId === initialInstanceId);
    expect(correction).toBeTruthy();
    expect(Number(correction.quantityDelta)).toBe(1);

    const savedPlanResponse = await page.request.get(`/api/meal-plan?weekStart=${encodeURIComponent(weekStart)}`);
    expect(savedPlanResponse.ok()).toBeTruthy();
    const savedPlan = await savedPlanResponse.json();
    const savedInstanceId = savedPlan.days[pastDayIndex].meals.find(meal => meal.mealType === 'dinner').instanceId;
    expect(savedInstanceId).toBe(initialInstanceId);

    await page.getByRole('button', { name: 'Didn’t make this meal' }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'Didn’t make this meal?' });
    await confirmation.getByRole('button', { name: 'Restore Pantry' }).click();
    await expect(page.getByText('Pantry restored for this meal')).toBeVisible();
    expect(await inventoryQuantity(page, item._id)).toBe(4);

    history = await inventoryHistory(page, item._id);
    const reversal = history.find(event => event.type === 'reversal' && String(event.reversesEventId || '') === String(consumption._id));
    expect(reversal).toBeTruthy();
    expect(Number(reversal.quantityDelta)).toBe(1);
  });
});