const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Shopping List Tab', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    const clearResponse = await page.request.delete('/api/shopping-list');
    expect(clearResponse.ok()).toBeTruthy();
    await page.click('[data-tab="list"]');
  });

  test('"+ Add" button opens the add item modal', async ({ page }) => {
    await page.click('#btn-add-list-item');
    await expect(page.locator('#modal-overlay')).toBeVisible();
  });

  test('modal closes when X button is clicked', async ({ page }) => {
    await page.click('#btn-add-list-item');
    await page.click('#modal-close');
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });

  test('"Clear Checked" stays out of the way until an item is checked', async ({ page }) => {
    await expect(page.locator('#btn-clear-checked')).toBeHidden();
  });

  test('"Clear All" stays out of the way on an empty list', async ({ page }) => {
    await expect(page.locator('#btn-clear-all')).toBeHidden();
  });

  test('checking an item is instant and defers missing prices to trip review', async ({ page }) => {
    const itemResponse = await page.request.post('/api/items', {
      data: { name: `Instant Check ${Date.now()}`, category: 'Other', unit: 'each' }
    });
    expect(itemResponse.ok()).toBeTruthy();
    const item = await itemResponse.json();
    const listResponse = await page.request.post('/api/shopping-list', {
      data: { itemId: item._id, quantity: 1 }
    });
    expect(listResponse.ok()).toBeTruthy();

    await page.click('[data-tab="home"]');
    await page.click('[data-tab="list"]');
    const card = page.locator(`.list-item[data-id="${(await listResponse.json())._id}"]`);
    await card.locator('.list-item-check-wrap').click();

    await expect(card).toHaveClass(/checked/);
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('#cart-bar-label')).toContainText('1 need price');

    await page.click('#cart-bar-summary');
    await page.click('#btn-done-shopping');
    await expect(page.locator('#modal-title')).toHaveText('Review shopping trip');
    await expect(page.locator('.trip-review-warning')).toContainText('1 item needs prices');
  });

  test('Done Shopping updates Pantry, price history, Spend, and clears the list', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const itemResponse = await page.request.post('/api/items', {
      data: { name: `Trip Bread ${suffix}`, category: 'Bakery', unit: 'loaf' }
    });
    const storeResponse = await page.request.post('/api/stores', {
      data: { name: `Trip Store ${suffix}` }
    });
    expect(itemResponse.ok()).toBeTruthy();
    expect(storeResponse.ok()).toBeTruthy();
    const item = await itemResponse.json();
    const store = await storeResponse.json();
    const listResponse = await page.request.post('/api/shopping-list', {
      data: { itemId: item._id, quantity: 2, storeId: store._id }
    });
    expect(listResponse.ok()).toBeTruthy();
    const listItem = await listResponse.json();

    await page.click('[data-tab="home"]');
    await page.click('[data-tab="list"]');
    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await card.locator('.list-item-check-wrap').click();
    await page.click('#cart-bar-summary');
    await page.click('#btn-done-shopping');

    const reviewRow = page.locator(`.trip-review-item[data-list-item-id="${listItem._id}"]`);
    await reviewRow.locator('.trip-store-select').selectOption(store._id);
    await reviewRow.locator('.trip-price-input').fill('7.98');
    await page.click('#btn-finish-trip');

    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator(`.list-item[data-id="${listItem._id}"]`)).toHaveCount(0);

    const [pantryResponse, pricesResponse, spendResponse] = await Promise.all([
      page.request.get('/api/inventory'),
      page.request.get(`/api/prices/history/${item._id}`),
      page.request.get(`/api/spend?month=${new Date().toISOString().slice(0, 7)}`)
    ]);
    const pantry = await pantryResponse.json();
    const prices = await pricesResponse.json();
    const spend = await spendResponse.json();
    expect(pantry.find(entry => entry.itemId?._id === item._id)?.quantity).toBe(2);
    expect(prices[0]).toMatchObject({ source: 'shopping-trip', finalPrice: 7.98, quantity: 2 });
    expect(spend.total).toBeCloseTo(7.98);
  });
});
