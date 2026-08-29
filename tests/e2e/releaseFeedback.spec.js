const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

async function createItem(page, name, category = 'Other', unit = 'each') {
  const response = await page.request.post('/api/items', {
    data: { name, category, unit }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createStore(page, name) {
  const response = await page.request.post('/api/stores', {
    data: { name, location: 'Release feedback test' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function recordPrice(page, itemId, storeId, price = 4.25) {
  const response = await page.request.post('/api/prices', {
    data: {
      itemId,
      storeId,
      regularPrice: price,
      quantity: 1,
      date: new Date().toISOString().slice(0, 10),
      source: 'manual'
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openPriceHistory(page) {
  await page.click('[data-tab="more"]');
  await page.locator('.more-item[data-section="insights"]').click();

  // The Insights click handler starts switchTab() without returning its promise,
  // so an active tab is not proof that the async price load has completed.
  // Observe the request before clicking, then wait for both the response and
  // the loading skeleton to leave the DOM.
  const pricesLoaded = page.waitForResponse(response => {
    const url = new URL(response.url());
    return response.request().method() === 'GET' && url.pathname === '/api/prices';
  });
  await page.locator('[data-insight-tab="prices"]').click();
  const response = await pricesLoaded;
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('#tab-prices')).toHaveClass(/active/);
  await expect(page.locator('#prices-list .skeleton-card')).toHaveCount(0, { timeout: 10000 });
}

test.describe('Post-release recovery states', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
  });

  test('Manage Products turns an unfiltered no-match search into a prefilled Add Product action', async ({ page }) => {
    const name = `Oat Creamer ${Date.now()}`;

    await page.click('[data-tab="more"]');
    await page.locator('.more-item[data-section="items"]').click();
    await page.fill('#catalog-search', name);

    await expect(page.getByText(`No products match “${name}”.`)).toBeVisible();
    const addProduct = page.getByRole('button', { name: `Add Product “${name}”` });
    await expect(addProduct).toBeVisible();
    await addProduct.click();

    await expect(page.locator('#modal-title')).toHaveText('New Item');
    await expect(page.locator('#new-item-form [name="name"]')).toHaveValue(name);
    await page.fill('#new-item-form [name="category"]', 'Beverages');
    await page.fill('#new-item-form [name="unit"]', 'each');
    await page.getByRole('button', { name: 'Create Item' }).click();

    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('#catalog-search')).toHaveValue('');
    await expect(page.locator('#catalog-list .card', { hasText: name })).toBeVisible();
  });

  test('Manage Products clears filters instead of suggesting creation when an existing product is hidden', async ({ page }) => {
    const suffix = Date.now();
    const visibleUnderFilter = await createItem(page, `Filtered Dairy ${suffix}`, 'Dairy');
    const hiddenByFilter = await createItem(page, `Hidden Beverage ${suffix}`, 'Beverages');
    expect(visibleUnderFilter._id).toBeTruthy();

    await page.click('[data-tab="more"]');
    await page.locator('.more-item[data-section="items"]').click();
    await expect(page.getByText(hiddenByFilter.name, { exact: true })).toBeVisible();

    await page.locator('#btn-catalog-filter').click();
    await page.locator('#catalog-category-chips [data-category="Dairy"]').click();
    await page.locator('#filter-sheet-done').click();
    await page.fill('#catalog-search', hiddenByFilter.name);

    await expect(page.getByText(`No products match “${hiddenByFilter.name}” with the current filters.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    await expect(page.getByRole('button', { name: `Add Product “${hiddenByFilter.name}”` })).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByText(hiddenByFilter.name, { exact: true })).toBeVisible();
  });

  test('Price History offers Record price when the household has no history', async ({ page }) => {
    await openPriceHistory(page);

    const emptyRecord = page.locator('#prices-empty-record');
    await expect(emptyRecord).toBeVisible();
    await expect(page.locator('#prices-list')).toContainText('No price history yet. Record the first price your household paid.');
    await emptyRecord.click();

    await expect(page.locator('#modal-overlay')).toBeVisible();
    await expect(page.locator('#modal-title')).toContainText('Add Grocery');
  });

  test('Price History search miss offers Clear search instead of claiming there is no history', async ({ page }) => {
    const suffix = Date.now();
    const item = await createItem(page, `Known Price ${suffix}`, 'Dairy');
    const store = await createStore(page, `Price Store ${suffix}`);
    await recordPrice(page, item._id, store._id);

    await openPriceHistory(page);
    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
    await page.fill('#price-search', `Missing ${suffix}`);

    await expect(page.locator('#prices-list')).toContainText('No price history matches');
    await expect(page.locator('#prices-list')).not.toContainText('No price history yet');
    await page.getByRole('button', { name: 'Clear search' }).click();

    await expect(page.locator('#price-search')).toHaveValue('');
    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
  });

  test('Price History filter miss offers Clear filters and restores existing history', async ({ page }) => {
    const suffix = Date.now();
    const item = await createItem(page, `Conventional Price ${suffix}`, 'Dairy');
    const store = await createStore(page, `Filter Store ${suffix}`);
    await recordPrice(page, item._id, store._id);

    await openPriceHistory(page);
    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
    await page.locator('#btn-prices-filter').click();
    await page.getByLabel('Organic only').check();
    await page.locator('#filter-sheet-done').click();

    await expect(page.getByText('No price history matches the current filters.')).toBeVisible();
    const clearFilters = page.getByRole('button', { name: 'Clear filters' });
    await expect(clearFilters).toBeVisible();
    await clearFilters.click();

    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
  });
});
