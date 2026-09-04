const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createProduct(page, name, category = 'Other') {
  const response = await page.request.post('/api/items', {
    data: { name, category, unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe('PRO-83 React Manage Products', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
  });

  test('routes Manage products through React and turns a no-match search into a prefilled add flow', async ({ page }) => {
    const name = `React Catalog Creamer ${Date.now()}`;
    await page.goto('/app/more');
    await page.getByRole('link', { name: /Manage products/ }).click();

    await expect(page).toHaveURL(/\/app\/more\/products$/);
    await expect(page.locator('#catalog-title')).toHaveText('Manage products');
    await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#catalog-list')).toHaveCount(0);

    await page.getByLabel('Search products').fill(name);
    await expect(page.getByText(`No products match “${name}”`)).toBeVisible();
    await page.getByRole('button', { name: `Add product “${name}”` }).click();

    const editor = page.getByRole('dialog', { name: 'Add product' });
    await expect(editor.getByLabel('Name')).toHaveValue(name);
    await editor.getByLabel('Category').fill('Beverages');
    await editor.getByRole('button', { name: 'Add product', exact: true }).click();
    await expect(editor).toHaveCount(0);

    const row = page.locator('.catalog-row', { hasText: name });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Edit ${name}` }).click();
    const edit = page.getByRole('dialog', { name });
    await edit.getByLabel(/Brand/).fill('Provista Test');
    await edit.getByRole('button', { name: 'Save product' }).click();
    await expect(row).toContainText('Provista Test');
  });

  test('keeps existing sort and structured filters in the React catalog', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const older = await createProduct(page, `Alpha Older ${suffix}`, 'Dairy');
    const newer = await createProduct(page, `Zulu Newer ${suffix}`, 'Beverages');
    const store = await page.request.post('/api/stores', { data: { name: `Catalog Sort Store ${suffix}` } }).then(response => response.json());
    expect((await page.request.post('/api/prices', {
      data: { itemId: older._id, storeId: store._id, regularPrice: 2, quantity: 1, date: '2026-08-01', source: 'manual' }
    })).ok()).toBeTruthy();
    expect((await page.request.post('/api/prices', {
      data: { itemId: newer._id, storeId: store._id, regularPrice: 3, quantity: 1, date: '2026-09-01', source: 'manual' }
    })).ok()).toBeTruthy();

    await page.goto('/app/more/products');
    await page.getByLabel('Sort').selectOption('lastPurchased');
    const rows = page.locator('.catalog-row');
    await expect(rows.first()).toContainText(newer.name);
    await expect(page.locator('.catalog-row', { hasText: newer.name })).toContainText('Last purchased');

    await page.locator('.catalog-category-filter').getByText('Categories', { exact: false }).click();
    await page.locator('.catalog-category-filter').getByLabel('Dairy').check();
    await expect(page.locator('.catalog-row', { hasText: older.name })).toBeVisible();
    await expect(page.locator('.catalog-row', { hasText: newer.name })).toHaveCount(0);
  });

  test('keeps scan first-class and product rows compact on mobile at 200 percent text', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const product = await createProduct(page, `Compact Catalog Product ${suffix}`, 'Pantry');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/more/products');

    const row = page.locator('.catalog-row', { hasText: product.name });
    await expect(row.getByRole('button', { name: `Edit ${product.name}` })).toBeVisible();
    await expect(row.getByRole('button', { name: `Delete ${product.name}` })).toBeVisible();
    const rowHeight = await row.evaluate(element => element.getBoundingClientRect().height);
    expect(rowHeight).toBeLessThan(100);

    await page.getByRole('button', { name: 'Scan', exact: true }).click();
    const scanner = page.getByRole('dialog', { name: 'Scan a product' });
    await expect(scanner).toBeVisible();
    await scanner.getByRole('button', { name: 'Close Scan a product' }).click();

    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await expect(row.getByRole('button', { name: `Edit ${product.name}` })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('merges a duplicate through React while preserving List, Pantry, and price references', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const source = await createProduct(page, `Duplicate Beans ${suffix}`, 'Pantry');
    const target = await createProduct(page, `Black Beans ${suffix}`, 'Pantry');
    const store = await page.request.post('/api/stores', { data: { name: `Merge Store ${suffix}` } }).then(response => response.json());

    expect((await page.request.post('/api/prices', {
      data: { itemId: source._id, storeId: store._id, regularPrice: 2.49, quantity: 1, date: '2026-09-01', source: 'manual' }
    })).ok()).toBeTruthy();
    expect((await page.request.post('/api/shopping-list', {
      data: { itemId: source._id, quantity: 3 }
    })).ok()).toBeTruthy();
    expect((await page.request.post('/api/inventory', {
      data: { itemId: source._id, quantity: 4, unit: 'each', stockStatus: 'have' }
    })).ok()).toBeTruthy();

    await page.goto('/app/more/products');
    const cleanup = page.locator('.catalog-merge-panel');
    await cleanup.getByText('Catalog cleanup', { exact: true }).click();
    await cleanup.getByLabel('Duplicate to remove').selectOption(source._id);
    await cleanup.getByLabel('Product to keep').selectOption(target._id);
    await cleanup.getByRole('button', { name: 'Review merge' }).click();

    const confirmation = page.getByRole('dialog', { name: `Merge ${source.name} into ${target.name}?`, exact: true });
    await expect(confirmation).toContainText(`Price history, Shopping List entries, and Pantry references will move to ${target.name}`);
    await confirmation.getByRole('button', { name: 'Merge products', exact: true }).click();

    await expect(page.locator('.catalog-row', { hasText: source.name })).toHaveCount(0);
    await expect(page.locator('.catalog-row', { hasText: target.name })).toBeVisible();

    const [itemsResponse, listResponse, pantryResponse, pricesResponse] = await Promise.all([
      page.request.get('/api/items'),
      page.request.get('/api/shopping-list'),
      page.request.get('/api/inventory'),
      page.request.get('/api/prices')
    ]);
    const items = await itemsResponse.json();
    expect(items.some(item => item._id === source._id)).toBe(false);
    expect((await listResponse.json()).some(item => String(item.itemId?._id || item.itemId) === target._id)).toBe(true);
    expect((await pantryResponse.json()).some(item => String(item.itemId?._id || item.itemId) === target._id)).toBe(true);
    expect((await pricesResponse.json()).some(entry => String(entry.itemId?._id || entry.itemId) === target._id)).toBe(true);
  });

  test('rejects self-merge and invalid targets without deleting the source product', async ({ page }) => {
    const source = await createProduct(page, `Merge Safety ${Date.now()}`, 'Pantry');

    const selfMerge = await page.request.post(`/api/items/${source._id}/merge`, { data: { targetId: source._id } });
    expect(selfMerge.status()).toBe(400);

    const missingMerge = await page.request.post(`/api/items/${source._id}/merge`, {
      data: { targetId: '507f1f77bcf86cd799439011' }
    });
    expect(missingMerge.status()).toBe(404);

    const itemsResponse = await page.request.get('/api/items');
    const items = await itemsResponse.json();
    expect(items.some(item => item._id === source._id)).toBe(true);
  });
});