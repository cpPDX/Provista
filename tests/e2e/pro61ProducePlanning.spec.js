const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createProduct(page, name) {
  const response = await page.request.post('/api/items', {
    data: { name, category: 'Produce', unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createPantryItem(page, item, data = {}) {
  const response = await page.request.post('/api/inventory', {
    data: { itemId: item._id, unit: item.unit || 'each', trackingMode: 'simple', stockStatus: 'have', ...data }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

function inventoryMatches(items, name) {
  return items.filter(entry => {
    const product = entry.itemId && typeof entry.itemId === 'object' ? entry.itemId : null;
    return product?.name === name;
  });
}

test.describe('PRO-61 Pantry-backed produce planning', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
  });

  test('shows existing Pantry produce and reflects Pantry state without a second produce list', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const product = await createProduct(page, `PRO61 Spinach ${suffix}`);
    const pantryItem = await createPantryItem(page, product, { stockStatus: 'low' });

    await page.goto('/app/plan');
    const view = page.getByRole('region', { name: 'Produce to use this week' });
    await expect(view).toBeVisible();
    await expect(view).toContainText(product.name);
    await expect(view).toContainText('Running low');
    await expect(page.locator('#plan-produce-notes')).toBeHidden();

    const update = await page.request.put(`/api/inventory/${pantryItem._id}`, {
      data: { trackingMode: 'simple', stockStatus: 'out' }
    });
    expect(update.ok()).toBeTruthy();
    await page.reload();

    await expect(view).toContainText(product.name);
    await expect(view).toContainText('Out');
  });

  test('creates or reuses the shared catalog identity and never duplicates the Pantry item', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const name = `PRO61 Arugula ${suffix}`;

    await page.goto('/app/plan');
    const view = page.getByRole('region', { name: 'Produce to use this week' });
    const input = view.getByLabel('Add produce you already have');
    await input.fill(name);
    await view.getByRole('button', { name: 'Add to Pantry' }).click();
    await expect(view).toContainText(name);

    let inventoryResponse = await page.request.get('/api/inventory');
    expect(inventoryResponse.ok()).toBeTruthy();
    let inventory = await inventoryResponse.json();
    expect(inventoryMatches(inventory, name)).toHaveLength(1);

    await input.fill(name);
    await view.getByRole('button', { name: 'Add to Pantry' }).click();
    await expect(page.getByText(`${name} is already in Pantry.`)).toBeVisible();

    inventoryResponse = await page.request.get('/api/inventory');
    expect(inventoryResponse.ok()).toBeTruthy();
    inventory = await inventoryResponse.json();
    expect(inventoryMatches(inventory, name)).toHaveLength(1);
  });
});
