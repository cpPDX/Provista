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

function pantryProduct(entry) {
  return entry.itemId && typeof entry.itemId === 'object' ? entry.itemId : null;
}

function inventoryMatchesResolved(items, { id, name }) {
  return items.filter(entry => {
    const product = pantryProduct(entry);
    if (!product) return false;
    return id ? String(product._id) === String(id) : product.name === name;
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
    const requestedName = `PRO61 Arugula ${suffix}`;

    // Resolve through the same deterministic parser/matcher the UI uses. The
    // canonical identity can intentionally differ from the raw text the parent
    // typed (for example, a seeded “Arugula” catalog item).
    const matchResponse = await page.request.post('/api/items/match', {
      data: { text: requestedName }
    });
    expect(matchResponse.ok()).toBeTruthy();
    const match = await matchResponse.json();
    const suggestion = match.suggestions[0];
    const resolved = suggestion?.item
      ? { id: suggestion.item._id, name: suggestion.item.name }
      : { id: null, name: requestedName };

    await page.goto('/app/plan');
    const view = page.getByRole('region', { name: 'Produce to use this week' });
    const input = view.getByLabel('Add produce you already have');
    await input.fill(requestedName);
    await view.getByRole('button', { name: 'Add to Pantry' }).click();
    await expect(view).toContainText(resolved.name);

    let inventoryResponse = await page.request.get('/api/inventory');
    expect(inventoryResponse.ok()).toBeTruthy();
    let inventory = await inventoryResponse.json();
    expect(inventoryMatchesResolved(inventory, resolved)).toHaveLength(1);

    await input.fill(requestedName);
    await view.getByRole('button', { name: 'Add to Pantry' }).click();
    await expect(page.getByText(`${resolved.name} is already in Pantry.`)).toBeVisible();

    inventoryResponse = await page.request.get('/api/inventory');
    expect(inventoryResponse.ok()).toBeTruthy();
    inventory = await inventoryResponse.json();
    expect(inventoryMatchesResolved(inventory, resolved)).toHaveLength(1);
  });
});
