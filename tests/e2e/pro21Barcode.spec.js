const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

function unique(prefix) {
  return `${prefix} ${Date.now()}-${test.info().workerIndex}`;
}

async function createProduct(page, input = {}) {
  const response = await page.request.post('/api/items', {
    data: {
      name: input.name || unique('Barcode Product'),
      category: input.category || 'Pantry',
      unit: input.unit || 'each',
      ...(input.brand ? { brand: input.brand } : {}),
      ...(input.size != null ? { size: input.size } : {}),
      ...(input.upc ? { upc: input.upc, upcSource: 'manual' } : {})
    }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function enterManualUpc(page, upc) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const manualInput = dialog.getByLabel('UPC / EAN');
  if (!(await manualInput.isVisible().catch(() => false))) {
    await dialog.getByRole('button', { name: 'Enter UPC instead' }).click();
  }
  await expect(manualInput).toBeVisible();
  await manualInput.fill(upc);
  await dialog.getByRole('button', { name: 'Look up product' }).click();
}

test.describe('PRO-21 shared React barcode resolution', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    const clearList = await page.request.delete('/api/shopping-list');
    expect(clearList.ok()).toBeTruthy();
  });

  test('adds a known household UPC directly to List without leaving React', async ({ page }) => {
    const upc = '012345678905';
    const product = await createProduct(page, { name: unique('Known Barcode Milk'), category: 'Dairy', upc });

    await page.goto('/app/list');
    await page.getByRole('button', { name: 'Scan item', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Scan a grocery' })).toBeVisible();
    await enterManualUpc(page, upc);

    await expect(page.getByRole('dialog', { name: 'Scan a grocery' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/list/);
    await expect(page.locator('.react-list-item', { hasText: product.name })).toBeVisible();
    await expect(page.locator('#react-rapid-status')).toContainText('added from barcode');
  });

  test('does not ask for known product details again in Pantry', async ({ page }) => {
    const upc = '036000291452';
    const product = await createProduct(page, {
      name: unique('Known Barcode Cereal'),
      brand: 'Household Brand',
      category: 'Pantry',
      unit: 'box',
      upc
    });

    await page.goto('/app/pantry');
    await page.getByRole('button', { name: 'Scan package' }).click();
    await expect(page.getByRole('dialog', { name: 'Scan a package' })).toBeVisible();
    await enterManualUpc(page, upc);

    const tracking = page.getByRole('dialog', { name: `Track ${product.name}` });
    await expect(tracking).toBeVisible();
    await expect(tracking.getByLabel('Scanned product')).toContainText(product.name);
    await expect(tracking.getByLabel('Scanned product')).toContainText('Product identified');
    await expect(tracking.getByLabel('What do you want to track?')).toHaveCount(0);
    await tracking.getByRole('button', { name: 'Track item' }).click();

    await expect(tracking).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/pantry/);
    await expect(page.locator('.pantry-card', { hasText: product.name })).toBeVisible();
  });

  test('offers Scan to track alongside typed creation when Pantry search has no match', async ({ page }) => {
    await page.goto('/app/pantry');
    const missing = unique('No Pantry Match');
    await page.getByLabel('Search Pantry').fill(missing);

    await expect(page.getByText(`No Pantry items match “${missing}”.`)).toBeVisible();
    await expect(page.getByRole('button', { name: `Track “${missing}”` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scan to track' })).toBeVisible();
  });

  test('shows only missing fields for partial barcode metadata', async ({ page }) => {
    const upc = '4006381333931';
    await page.route(`**/api/barcode/${upc}`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          found: true,
          source: 'openFoodFacts',
          confidence: 'partial',
          autoAccept: false,
          item: {
            upc,
            name: 'Found Oat Milk',
            brand: 'Public Brand',
            category: 'Dairy',
            unit: null,
            size: 32,
            isOrganic: false
          },
          missingFields: ['unit'],
          enrichableFields: []
        })
      });
    });

    await page.goto('/app/list');
    await page.getByRole('button', { name: 'Scan item', exact: true }).first().click();
    await enterManualUpc(page, upc);

    const dialog = page.getByRole('dialog', { name: 'Scan a grocery' });
    await expect(dialog).toContainText('Found Oat Milk');
    await expect(dialog.getByLabel('Unit')).toBeVisible();
    await expect(dialog.getByLabel('Product name')).toHaveCount(0);
    await expect(dialog.getByLabel(/Brand/)).toHaveCount(0);
    await expect(dialog.getByLabel('Category')).toHaveCount(0);
    await expect(dialog.getByLabel(/Package size/)).toHaveCount(0);
  });

  test('shows a compact confirmation when public metadata is complete', async ({ page }) => {
    const upc = '9780201379624';
    await page.route(`**/api/barcode/${upc}`, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          found: true,
          source: 'openFoodFacts',
          confidence: 'full',
          autoAccept: false,
          item: {
            upc,
            name: 'Complete Public Product',
            brand: 'Public Brand',
            category: 'Pantry',
            unit: 'oz',
            size: 12,
            isOrganic: true
          },
          missingFields: [],
          enrichableFields: []
        })
      });
    });

    await page.goto('/app/list');
    await page.getByRole('button', { name: 'Scan item', exact: true }).first().click();
    await enterManualUpc(page, upc);

    const dialog = page.getByRole('dialog', { name: 'Scan a grocery' });
    await expect(dialog).toContainText('Complete Public Product');
    await expect(dialog).toContainText('Public Brand · Pantry · oz · 12');
    await expect(dialog.getByRole('button', { name: 'Correct found details' })).toBeVisible();
    await expect(dialog.locator('.barcode-review-fields')).toHaveCount(0);
  });

  test('manual UPC remains usable when camera permission is unavailable', async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto('/app/list');
    await page.getByRole('button', { name: 'Scan item', exact: true }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Scan a grocery' });
    await expect(dialog).toBeVisible();
    const manualButton = dialog.getByRole('button', { name: 'Enter UPC instead' });
    if (await manualButton.isVisible().catch(() => false)) await manualButton.click();
    await expect(dialog.getByLabel('UPC / EAN')).toBeVisible();
    await dialog.getByLabel('UPC / EAN').fill('123');
    await dialog.getByRole('button', { name: 'Look up product' }).click();
    await expect(dialog.getByRole('alert')).toContainText('8–14 digit UPC/EAN');
  });
});
