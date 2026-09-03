const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

test.describe('React Plan migration', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
  });

  test('routes Plan inside React and autosaves a real dinner', async ({ page }) => {
    await page.getByRole('button', { name: 'Plan', exact: true }).click();

    await expect(page).toHaveURL(/\/app\/plan$/);
    await expect(page.locator('#plan-title')).toHaveText('Plan');
    await expect(page.locator('.plan-day')).toHaveCount(7);
    await expect(page.getByRole('button', { name: 'Plan', exact: true })).toHaveAttribute('aria-current', 'page');

    const today = page.locator('.plan-day-today');
    await expect(today).toBeVisible();
    const dinner = today.locator('input[data-meal-name="dinner-0"]');
    const mealName = `React dinner ${Date.now()}`;
    await dinner.fill(mealName);

    await expect(page.locator('.plan-save-status')).toContainText('Saved', { timeout: 8000 });
    await expect.poll(async () => {
      const settings = await (await page.request.get('/api/meal-plan/settings')).json();
      const now = new Date();
      let offset = now.getDay() - settings.weekStartDay;
      if (offset < 0) offset += 7;
      now.setDate(now.getDate() - offset);
      const weekStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const plan = await (await page.request.get(`/api/meal-plan?weekStart=${weekStart}`)).json();
      const day = plan.days.find(entry => String(entry.date).slice(0, 10) === todayIso());
      return day?.meals.find(meal => meal.mealType === 'dinner')?.name;
    }).toBe(mealName);
  });

  test('serializes and coalesces autosaves while the previous write is slow', async ({ page }) => {
    let releaseFirstSave = () => {};
    const firstSaveGate = new Promise(resolve => {
      releaseFirstSave = resolve;
    });
    const savePayloads = [];
    let activeSaves = 0;
    let maxActiveSaves = 0;

    await page.route('**/api/meal-plan', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== 'PUT' || url.pathname !== '/api/meal-plan') {
        await route.continue();
        return;
      }

      savePayloads.push(request.postDataJSON());
      activeSaves += 1;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      try {
        if (savePayloads.length === 1) await firstSaveGate;
        const response = await route.fetch();
        await route.fulfill({ response });
      } finally {
        activeSaves -= 1;
      }
    });

    await page.goto('/app/plan');
    const dinner = page.locator('.plan-day-today input[data-meal-name="dinner-0"]');
    const firstMeal = `Slow first meal ${Date.now()}`;
    const intermediateMeal = `Intermediate meal ${Date.now()}`;
    const finalMeal = `Final meal ${Date.now()}`;

    await dinner.fill(firstMeal);
    await expect.poll(() => savePayloads.length).toBe(1);

    await dinner.fill(intermediateMeal);
    await page.waitForTimeout(750);
    await dinner.fill(finalMeal);
    await page.waitForTimeout(750);

    const requestsBeforeRelease = savePayloads.length;
    releaseFirstSave();
    expect(requestsBeforeRelease).toBe(1);

    await expect.poll(() => savePayloads.length).toBe(2);
    await expect(page.locator('.plan-save-status')).toContainText('Saved', { timeout: 8000 });
    expect(maxActiveSaves).toBe(1);
    expect(savePayloads).toHaveLength(2);

    const latestPayload = savePayloads[1];
    const latestDay = latestPayload.days.find(day => String(day.date).slice(0, 10) === todayIso());
    expect(latestDay?.meals.find(meal => meal.mealType === 'dinner')?.name).toBe(finalMeal);

    await expect.poll(async () => {
      const plan = await (await page.request.get(`/api/meal-plan?weekStart=${latestPayload.weekStart}`)).json();
      const day = plan.days.find(entry => String(entry.date).slice(0, 10) === todayIso());
      return day?.meals.find(meal => meal.mealType === 'dinner')?.name;
    }).toBe(finalMeal);
  });

  test('repeatedly returns to a cached Plan without entering a render loop', async ({ page }) => {
    const renderLoopErrors = [];
    page.on('console', message => {
      if (message.type() === 'error' && message.text().includes('Maximum update depth exceeded')) {
        renderLoopErrors.push(message.text());
      }
    });
    await page.route('**/api/shopping-list', async route => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      await route.continue();
    });

    await page.goto('/app/plan');
    await expect(page.locator('#plan-title')).toHaveText('Plan');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByRole('button', { name: 'List', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/list$/);
      await page.getByRole('button', { name: 'Plan', exact: true }).click();
      await expect(page).toHaveURL(/\/app\/plan$/);
      await expect(page.locator('#plan-title')).toHaveText('Plan');
    }

    await page.waitForTimeout(1000);
    expect(renderLoopErrors).toEqual([]);
  });

  test('shows household audience inline and saves planning-only people without accounts', async ({ page }) => {
    const personName = `Planner ${Date.now()}`;
    const personResponse = await page.request.post('/api/household/people', { data: { displayName: personName } });
    expect(personResponse.ok()).toBeTruthy();
    const person = await personResponse.json();

    await page.goto('/app/plan');
    const today = page.locator('.plan-day-today');
    const audience = today.locator('.plan-meal-section[data-meal-type="dinner"] .plan-audience').first();
    await expect(audience.locator('summary')).toContainText('Everyone');
    await audience.locator('summary').click();
    await audience.getByLabel('Everyone').uncheck();
    await audience.getByLabel(personName).check();

    await expect(audience.locator('summary')).toContainText(personName);
    await expect(page.locator('.plan-save-status')).toContainText('Saved', { timeout: 8000 });

    await expect.poll(async () => {
      const settings = await (await page.request.get('/api/meal-plan/settings')).json();
      const now = new Date();
      let offset = now.getDay() - settings.weekStartDay;
      if (offset < 0) offset += 7;
      now.setDate(now.getDate() - offset);
      const weekStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const plan = await (await page.request.get(`/api/meal-plan?weekStart=${weekStart}`)).json();
      const day = plan.days.find(entry => String(entry.date).slice(0, 10) === todayIso());
      const dinner = day?.meals.find(meal => meal.mealType === 'dinner');
      return dinner?.personIds?.map(String) || [];
    }).toContain(String(person._id));
  });

  test('saves before changing weeks instead of dropping the latest edit', async ({ page }) => {
    await page.goto('/app/plan');
    const mealName = `Before next week ${Date.now()}`;
    await page.locator('.plan-day-today input[data-meal-name="dinner-0"]').fill(mealName);

    await page.getByRole('button', { name: 'Next →' }).click();
    await expect(page.getByRole('button', { name: 'This week', exact: true })).toBeEnabled();
    await expect(page.locator('.plan-day')).toHaveCount(7);

    await page.getByRole('button', { name: '← Previous' }).click();
    await expect(page.getByRole('button', { name: 'This week', exact: true })).toBeDisabled();
    await expect(page.locator('.plan-day-today input[data-meal-name="dinner-0"]')).toHaveValue(mealName, { timeout: 8000 });
  });

  test('reviews meal shopping needs without deducting Pantry during planning', async ({ page }) => {
    const name = `Plan Pantry Item ${Date.now()}`;
    const itemResponse = await page.request.post('/api/items', { data: { name, category: 'Pantry', unit: 'each' } });
    expect(itemResponse.ok()).toBeTruthy();
    const item = await itemResponse.json();
    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { itemId: item._id, trackingMode: 'exact', quantity: 5, lowStockThreshold: 1, unit: 'each' }
    });
    expect(inventoryResponse.ok()).toBeTruthy();

    await page.goto('/app/plan');
    const today = page.locator('.plan-day-today');
    await today.locator('textarea').first().fill(`2 ${name}`);
    await today.getByRole('button', { name: 'Check shopping needs' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Check meal shopping needs' });
    await expect(dialog).toContainText(name);
    await expect(dialog).toContainText('Pantry 5');
    await expect(dialog).toContainText('after meal');
    await dialog.getByRole('button', { name: 'Done' }).click();

    const inventory = await (await page.request.get('/api/inventory')).json();
    expect(inventory.find(entry => entry.itemId?._id === item._id)?.quantity).toBe(5);
  });

  test('shows the saved weekly Pantry projection without deducting on-hand quantity', async ({ page }) => {
    const name = `Projected Pantry Item ${Date.now()}`;
    const itemResponse = await page.request.post('/api/items', { data: { name, category: 'Pantry', unit: 'each' } });
    expect(itemResponse.ok()).toBeTruthy();
    const item = await itemResponse.json();
    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { itemId: item._id, trackingMode: 'exact', quantity: 4, lowStockThreshold: 1, unit: 'each' }
    });
    expect(inventoryResponse.ok()).toBeTruthy();

    await page.goto('/app/plan');
    const today = page.locator('.plan-day-today');
    await today.locator('textarea').first().fill(`5 ${name}`);
    await expect(page.locator('.plan-save-status')).toContainText('Saved', { timeout: 8000 });

    const outlook = page.getByRole('region', { name: 'Pantry outlook' });
    await expect(outlook).toContainText(name);
    await expect(outlook).toContainText('On hand 4 each');
    await expect(outlook).toContainText('Planned 5 each');
    await expect(outlook).toContainText('Projected 0 each');
    await expect(outlook).toContainText('Buy 1 each');

    const inventory = await (await page.request.get('/api/inventory')).json();
    expect(inventory.find(entry => entry.itemId?._id === item._id)?.quantity).toBe(4);
  });
});
