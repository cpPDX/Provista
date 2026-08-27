const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

async function createCatalogItem(page, name) {
  const response = await page.request.post('/api/items', {
    data: { name, category: 'Other', unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openList(page) {
  await page.click('[data-tab="home"]');
  await page.click('[data-tab="list"]');
  await expect(page.locator('#rapid-list-capture')).toBeVisible();
}

test.describe('Rapid shopping capture', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    const clearResponse = await page.request.delete('/api/shopping-list');
    expect(clearResponse.ok()).toBeTruthy();
  });

  test('adds several known products and rolls quantity into an existing unchecked item', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const [milk, eggs, bananas] = await Promise.all([
      createCatalogItem(page, `Rapid Milk ${suffix}`),
      createCatalogItem(page, `Rapid Eggs ${suffix}`),
      createCatalogItem(page, `Rapid Bananas ${suffix}`)
    ]);

    const existingResponse = await page.request.post('/api/shopping-list', {
      data: { itemId: milk._id, quantity: 2 }
    });
    expect(existingResponse.ok()).toBeTruthy();

    await openList(page);
    await expect(page.getByText('Add groceries', { exact: true })).toBeVisible();
    await page.fill('#rapid-list-input', `${milk.name} x3, ${eggs.name}, ${bananas.name} x2`);
    await page.locator('#rapid-list-capture button[type="submit"]').click();

    await expect(page.locator('#rapid-list-status')).toHaveAttribute('data-state', 'success');
    await expect(page.locator('.list-item', { hasText: milk.name })).toContainText('qty 5');
    await expect(page.locator('.list-item', { hasText: eggs.name })).toContainText('qty 1');
    await expect(page.locator('.list-item', { hasText: bananas.name })).toContainText('qty 2');
    await expect(page.locator('#rapid-list-input')).toHaveValue('');
    await expect(page.locator('#rapid-review-details')).toBeHidden();

    const listResponse = await page.request.get('/api/shopping-list');
    expect(listResponse.ok()).toBeTruthy();
    const list = await listResponse.json();
    expect(list.filter(entry => [milk._id, eggs._id, bananas._id].includes(entry.itemId?._id))).toHaveLength(3);
  });

  test('routes ambiguous and unknown products directly into Add with details', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    await Promise.all([
      createCatalogItem(page, `Rapid Ambiguous ${suffix} One`),
      createCatalogItem(page, `Rapid Ambiguous ${suffix} Two`)
    ]);

    await openList(page);
    const ambiguous = `Rapid Ambiguous ${suffix}`;
    const missing = `Rapid Missing ${suffix}`;
    await page.fill('#rapid-list-input', `${ambiguous}, ${missing}`);
    await page.locator('#rapid-list-capture button[type="submit"]').click();

    await expect(page.locator('#rapid-list-status')).toHaveAttribute('data-state', 'warning');
    await expect(page.locator('#rapid-list-status')).toContainText('2 items need details');
    await expect(page.locator('#rapid-list-input')).toHaveValue(`${ambiguous}, ${missing}`);
    await expect(page.locator('#rapid-review-details')).toHaveText('Review 2 items with details');

    await page.locator('#rapid-review-details').click();
    await expect(page.locator('#modal-title')).toHaveText('Add with details');
    await expect(page.locator('#list-item-input')).toHaveValue(ambiguous);

    const listResponse = await page.request.get('/api/shopping-list');
    expect(listResponse.ok()).toBeTruthy();
    expect(await listResponse.json()).toHaveLength(0);
  });
});
