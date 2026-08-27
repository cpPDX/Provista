const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

function monthKey(offset = 0) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return date.toISOString().slice(0, 7);
}

function monthLabel(month) {
  return new Date(`${month}-01T00:00:00.000Z`).toLocaleString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC'
  });
}

function midMonthDate(month) {
  return `${month}-15T12:00:00.000Z`;
}

async function createItem(page, name, category = 'Other') {
  const response = await page.request.post('/api/items', {
    data: { name, category, unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createStore(page, name) {
  const response = await page.request.post('/api/stores', { data: { name } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function recordPrice(page, itemId, storeId, date, price = 4.25) {
  const response = await page.request.post('/api/prices', {
    data: { itemId, storeId, regularPrice: price, quantity: 1, date }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe('UX Batch 1 correctness journeys', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
  });

  test('two-store accidental cross-check cannot silently join the active stop', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const fred = await createStore(page, `Fred Meyer ${suffix}`);
    const target = await createStore(page, `Target ${suffix}`);
    const milk = await createItem(page, `Milk ${suffix}`, 'Dairy');
    const diapers = await createItem(page, `Diapers ${suffix}`, 'Cleaning & Household');

    const milkList = await page.request.post('/api/shopping-list', {
      data: { itemId: milk._id, quantity: 1, storeId: fred._id }
    });
    const diapersList = await page.request.post('/api/shopping-list', {
      data: { itemId: diapers._id, quantity: 1, storeId: target._id }
    });
    expect(milkList.ok()).toBeTruthy();
    expect(diapersList.ok()).toBeTruthy();

    await page.click('[data-tab="list"]');
    const milkCheck = page.getByRole('button', { name: `Mark as purchased ${milk.name}` });
    const diapersCheck = page.getByRole('button', { name: `Mark as purchased ${diapers.name}` });
    await milkCheck.click();
    await expect(page.locator('#cart-bar-label')).toContainText(fred.name);

    await diapersCheck.click();
    const conflict = page.getByRole('dialog', { name: `This item is planned for ${target.name}.` });
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: `Leave for ${target.name}` }).click();
    await expect(diapersCheck).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#cart-bar-label')).toContainText('1 bought');

    await page.locator('#btn-done-shopping').click();
    await expect(page.getByRole('dialog', { name: 'Finish shopping' })).toBeVisible();
    await expect(page.locator('#parent-trip-store')).toHaveValue(fred._id);
    await page.locator('#parent-finish-shopping').click();
    await expect(page.getByRole('button', { name: `Mark as purchased ${diapers.name}` })).toBeVisible();
    await expect(page.getByText(milk.name, { exact: true })).toHaveCount(0);

    let deferred = await (await page.request.get('/api/shopping-trips/deferred-prices')).json();
    const milkDeferred = deferred.find(entry => entry.itemId === milk._id);
    expect(milkDeferred).toMatchObject({ storeId: fred._id, storeName: fred.name });
    expect(deferred.find(entry => entry.itemId === diapers._id)).toBeUndefined();

    await page.getByRole('button', { name: `Mark as purchased ${diapers.name}` }).click();
    await expect(page.locator('#cart-bar-label')).toContainText(target.name);
    await page.locator('#btn-done-shopping').click();
    await expect(page.locator('#parent-trip-store')).toHaveValue(target._id);
    await page.locator('#parent-finish-shopping').click();

    deferred = await (await page.request.get('/api/shopping-trips/deferred-prices')).json();
    expect(deferred.find(entry => entry.itemId === milk._id)).toMatchObject({ storeId: fred._id });
    expect(deferred.find(entry => entry.itemId === diapers._id)).toMatchObject({ storeId: target._id });
  });

  test('unsaved actions keep editing, stop on save failure, and leave only after success', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const item = await createItem(page, `Unsaved Pantry ${suffix}`);
    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { itemId: item._id, trackingMode: 'simple', stockStatus: 'have', notes: '' }
    });
    expect(inventoryResponse.ok()).toBeTruthy();
    const inventory = await inventoryResponse.json();

    await page.click('[data-tab="inventory"]');
    const card = page.locator(`.pantry-card[data-inv-id="${inventory._id}"]`);
    await card.getByRole('button', { name: 'Edit details' }).click();
    await page.locator('#edit-inv-notes').fill('Keep this note');
    await page.click('[data-tab="home"]');

    const prompt = page.locator('#unsaved-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Keep editing' })).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Save & leave' })).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Discard & leave' })).toBeVisible();
    await prompt.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#edit-inv-notes')).toHaveValue('Keep this note');

    const inventoryRoute = `**/api/inventory/${inventory._id}`;
    await page.route(inventoryRoute, async route => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Forced save failure' }) });
      } else {
        await route.continue();
      }
    });

    await page.click('[data-tab="home"]');
    await prompt.getByRole('button', { name: 'Save & leave' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('Forced save failure');
    await expect(page.locator('#tab-inventory')).toHaveClass(/active/);
    expect(await page.evaluate(() => window._dirtyForm?.isDirty)).toBe(true);

    await page.unroute(inventoryRoute);
    await page.click('[data-tab="home"]');
    await prompt.getByRole('button', { name: 'Save & leave' }).click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('#tab-home')).toHaveClass(/active/);

    const saved = await (await page.request.get('/api/inventory')).json();
    expect(saved.find(entry => entry._id === inventory._id)?.notes).toBe('Keep this note');
  });

  test('Spending drill-down preserves the selected calendar month and back navigation', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const currentMonth = monthKey(0);
    const selectedMonth = monthKey(-1);
    const earlierMonth = monthKey(-2);
    const store = await createStore(page, `Month Store ${suffix}`);
    const earlier = await createItem(page, `Earlier Dairy ${suffix}`, 'Dairy');
    const selected = await createItem(page, `Selected Dairy ${suffix}`, 'Dairy');
    const current = await createItem(page, `Current Dairy ${suffix}`, 'Dairy');
    await recordPrice(page, earlier._id, store._id, midMonthDate(earlierMonth), 2.15);
    await recordPrice(page, selected._id, store._id, midMonthDate(selectedMonth), 3.15);
    await recordPrice(page, current._id, store._id, midMonthDate(currentMonth), 4.15);

    await page.click('[data-tab="more"]');
    await page.getByRole('button', { name: /Insights/ }).click();
    await page.locator('[data-insight-tab="spend"]').click();
    await expect(page.locator('#spend-month-label')).toHaveText(monthLabel(currentMonth));
    await expect(page.locator('#btn-next-month')).toBeDisabled();

    await page.locator('#btn-prev-month').click();
    await expect(page.locator('#spend-month-label')).toHaveText(monthLabel(selectedMonth));
    await page.locator('#spend-by-category .breakdown-item', { hasText: 'Dairy' }).click();

    await expect(page.locator('#tab-prices')).toHaveClass(/active/);
    await expect(page.locator('#prices-filter-count')).toContainText(monthLabel(selectedMonth));
    await expect(page.getByText(selected.name, { exact: true })).toBeVisible();
    await expect(page.getByText(earlier.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(current.name, { exact: true })).toHaveCount(0);

    await page.locator('#tab-prices .insights-back').click();
    await expect(page.locator('#tab-spend')).toHaveClass(/active/);
    await expect(page.locator('#spend-month-label')).toHaveText(monthLabel(selectedMonth));
  });

  test('Manage Products sorts Last purchased correctly on a fresh session', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const store = await createStore(page, `Catalog Store ${suffix}`);
    const older = await createItem(page, `Older Product ${suffix}`);
    const newer = await createItem(page, `Newer Product ${suffix}`);
    const never = await createItem(page, `Never Product ${suffix}`);
    await recordPrice(page, older._id, store._id, midMonthDate(monthKey(-2)), 2.1);
    await recordPrice(page, newer._id, store._id, midMonthDate(monthKey(0)), 3.1);

    // Do not visit Price History before opening Manage Products.
    await page.click('[data-tab="more"]');
    await page.locator('.more-item[data-section="items"]').click();
    await expect(page.getByText(newer.name, { exact: true })).toBeVisible();
    await page.locator('#btn-catalog-filter').click();
    await page.locator('#catalog-sort-chips [data-sort="lastPurchased"]').click();
    await page.locator('#filter-sheet-done').click();

    const namedCards = page.locator('#catalog-list .card').filter({ hasText: suffix });
    await expect(namedCards).toHaveCount(3);
    const names = await namedCards.locator('.card-title').allTextContents();
    expect(names[0]).toContain(newer.name);
    expect(names[1]).toContain(older.name);
    expect(names[2]).toContain(never.name);
    await expect(namedCards.nth(2)).toContainText('No purchase history');
  });
});
