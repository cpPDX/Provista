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
  const offset = date.getDay();
  date.setDate(date.getDate() - offset);
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

function dinner(days, dayIndex, name, notes = '') {
  const meal = days[dayIndex].meals.find(entry => entry.mealType === 'dinner');
  meal.name = name;
  meal.notes = notes;
}

async function seedPlan(page, days, weekStart) {
  const settings = await page.request.put('/api/meal-plan/settings', {
    data: { weekStartDay: 0, mealPlanMode: 'dinner' }
  });
  expect(settings.ok()).toBeTruthy();
  const plan = await page.request.put('/api/meal-plan', {
    data: { weekStart, days, produceNotes: '', shoppingNotes: '' }
  });
  expect(plan.ok()).toBeTruthy();
}

async function savePlanContext(page, weekStart, date, mealType = 'dinner', rowIndex = 0) {
  await page.evaluate(context => {
    sessionStorage.setItem('provista-plan-context', JSON.stringify(context));
  }, { weekStart, date, mealType, rowIndex });
}

test.describe('PRO-72 focused Plan workflow', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
  });

  test('keeps the weekly Pantry outlook compact until the user asks for detail', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const weekStart = currentWeekStart();
    const days = blankWeek(weekStart);
    const itemName = `PRO72 Pantry ${suffix}`;
    const itemResponse = await page.request.post('/api/items', {
      data: { name: itemName, category: 'Other', unit: 'each' }
    });
    expect(itemResponse.ok()).toBeTruthy();
    dinner(days, 0, 'Pantry Test Dinner', itemName);
    await seedPlan(page, days, weekStart);
    await savePlanContext(page, weekStart, addDays(weekStart, 0));

    await page.goto('/app/plan');
    const outlook = page.locator('.plan-pantry-outlook');
    await expect(outlook).toBeVisible();
    await expect(outlook.locator('summary')).toContainText('1 shortage this week · 0 covered');
    await expect(outlook).not.toHaveAttribute('open', '');
    await expect(outlook.locator('.plan-pantry-outlook-items')).not.toBeVisible();

    await outlook.locator('summary').click();
    await expect(outlook).toHaveAttribute('open', '');
    await expect(outlook.locator('.plan-pantry-outlook-items')).toContainText(itemName);
    await expect(outlook.locator('.plan-pantry-outlook-items')).toContainText('Buy 1 each');
  });

  test('carries an unmatched Plan need into List details and returns to the exact Plan context', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const weekStart = currentWeekStart();
    const days = blankWeek(weekStart);
    const dayIndex = 2;
    const need = `PRO72 Missing Spice ${suffix}`;
    dinner(days, dayIndex, 'Context Dinner', `${need} x2`);
    await seedPlan(page, days, weekStart);
    await savePlanContext(page, weekStart, addDays(weekStart, dayIndex));

    await page.goto('/app/plan');
    const focusedDay = page.locator(`.plan-focused-day[data-plan-day="${dayIndex}"]`);
    await expect(focusedDay).toBeVisible();
    await expect(focusedDay.locator('input[data-meal-name="dinner-0"]')).toHaveValue('Context Dinner');
    await focusedDay.getByRole('button', { name: 'Check shopping needs' }).click();

    const review = page.getByRole('dialog', { name: 'Check meal shopping needs' });
    await expect(review).toContainText(need);
    await review.getByRole('button', { name: 'Add with details in List' }).click();

    await expect(page).toHaveURL(/\/app\/list\?from=plan/);
    const details = page.getByRole('dialog', { name: 'Add with details' });
    await expect(details).toBeVisible();
    await expect(details.locator('#react-list-detail-product-name')).toHaveValue(need);
    await expect(details.locator('input[type="number"]')).toHaveValue('2');
    await details.getByRole('button', { name: 'Create & add' }).click();
    await expect(details).toHaveCount(0);

    const returnPanel = page.locator('.react-list-plan-return');
    await expect(returnPanel).toContainText('Your exact day, meal, and household group are preserved.');
    await returnPanel.getByRole('button', { name: 'Back to Plan' }).click();

    await expect(page).toHaveURL(/\/app\/plan/);
    const restored = page.locator(`.plan-focused-day[data-plan-day="${dayIndex}"]`);
    await expect(restored).toBeVisible();
    await expect(restored.locator('input[data-meal-name="dinner-0"]')).toHaveValue('Context Dinner');
  });

  test('offers forward progression explicitly and reports a fully planned week', async ({ page }) => {
    const weekStart = currentWeekStart();
    const days = blankWeek(weekStart);
    dinner(days, 0, 'First Dinner');
    await seedPlan(page, days, weekStart);
    await savePlanContext(page, weekStart, addDays(weekStart, 0));

    await page.goto('/app/plan');
    await expect(page.locator('.plan-focused-day[data-plan-day="0"] input[data-meal-name="dinner-0"]')).toHaveValue('First Dinner');
    const next = page.getByRole('button', { name: /Next: .* · Dinner/ });
    await expect(next).toBeVisible();
    await expect(page.locator('.plan-focused-day[data-plan-day="0"]')).toBeVisible();

    await next.click();
    await expect(page.locator('.plan-focused-day[data-plan-day="1"]')).toBeVisible();
    await expect(page.locator('.plan-focused-day[data-plan-day="1"] input[data-meal-name="dinner-0"]')).toBeFocused();

    const completeDays = blankWeek(weekStart);
    completeDays.forEach((_, index) => dinner(completeDays, index, `Dinner ${index + 1}`));
    await seedPlan(page, completeDays, weekStart);
    await savePlanContext(page, weekStart, addDays(weekStart, 6));
    await page.goto('/app/plan');

    await expect(page.locator('.plan-week-complete')).toContainText('Week planned');
    await expect(page.locator('.plan-week-complete')).toContainText('Every meal shown for this week has a plan.');
  });
});
