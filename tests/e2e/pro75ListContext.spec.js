const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createCatalogItem(page, name, unit = 'each') {
  const response = await page.request.post('/api/items', {
    data: { name, category: 'Pantry', unit }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createStore(page, name) {
  const response = await page.request.post('/api/stores', { data: { name } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function listItemFor(page, itemId) {
  const response = await page.request.get('/api/shopping-list');
  expect(response.ok()).toBeTruthy();
  const list = await response.json();
  return list.find(entry => String(entry.itemId?._id || entry.itemId) === String(itemId));
}

test.describe('PRO-75 contextual List setup', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    const clear = await page.request.delete('/api/shopping-list');
    expect(clear.ok()).toBeTruthy();
  });

  test('keeps required, intended, actual, and current-trip store separate through checkout', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const product = await createCatalogItem(page, `PRO75 Black Beans ${suffix}`, 'can');
    const currentStore = await createStore(page, `PRO75 Current Market ${suffix}`);

    const generated = await page.request.post('/api/shopping-list/from-meal', {
      data: { items: [{ itemId: product._id, quantity: 1 }] }
    });
    expect(generated.ok()).toBeTruthy();
    let listItem = await listItemFor(page, product._id);
    expect(listItem.requiredQuantity).toBe(1);
    expect(listItem.quantitySource).toBe('system');

    const preferCurrent = await page.request.put(`/api/shopping-list/${listItem._id}`, {
      data: { storeId: currentStore._id }
    });
    expect(preferCurrent.ok()).toBeTruthy();

    await page.goto('/app/list');
    let card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await expect(card).toContainText('Buy 1');
    await card.getByRole('button', { name: `Open item details for ${product.name}` }).click();
    let details = page.getByRole('dialog', { name: product.name });
    await expect(details).toContainText('1 required');
    await details.getByRole('button', { name: 'Close item details' }).click();

    await card.getByRole('button', { name: `Edit quantity for ${product.name}, currently 1` }).click();
    let quantityDialog = page.getByRole('dialog', { name: `Edit ${product.name}` });
    await expect(quantityDialog).toHaveCount(1);
    await quantityDialog.getByLabel('Plan to buy').fill('5');
    await quantityDialog.getByRole('button', { name: 'Save quantity' }).click();
    await expect(quantityDialog).toHaveCount(0);
    await expect(card).toContainText('Buy 5');

    listItem = await listItemFor(page, product._id);
    expect(listItem.requiredQuantity).toBe(1);
    expect(listItem.quantity).toBe(5);
    expect(listItem.quantitySource).toBe('user');

    await card.locator('.list-item-check-wrap').click();
    await expect(card).toHaveClass(/checked/);
    await card.getByRole('button', { name: `Open item details for ${product.name}` }).click();
    details = page.getByRole('dialog', { name: product.name });
    await expect(details).toContainText(`Current trip: ${currentStore.name}`);
    await details.getByRole('button', { name: 'Edit quantity' }).click();
    quantityDialog = page.getByRole('dialog', { name: `Edit ${product.name}` });
    await expect(quantityDialog.getByLabel('Plan to buy')).toHaveValue('5');
    await quantityDialog.getByLabel('Actually got').fill('4');
    await quantityDialog.getByRole('button', { name: 'Save quantity' }).click();
    await expect(details).toContainText('got 4');

    await details.getByRole('button', { name: new RegExp(`Store preference for ${product.name}`) }).click();
    const storeDialog = page.getByRole('dialog', { name: 'Store preference' });
    await expect(storeDialog).toHaveCount(1);
    await storeDialog.locator('select').selectOption({ label: 'Another store…' });
    await expect(storeDialog.getByLabel('Store name')).toBeVisible();
    const futureName = `PRO75 Future Market ${suffix}`;
    await storeDialog.getByLabel('Store name').fill(futureName);
    await storeDialog.getByRole('button', { name: 'Add and select' }).click();
    await expect(storeDialog).toHaveCount(0);

    card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await expect(details).toContainText(`Store preference: ${futureName}`);
    await expect(details).toContainText(`Current trip: ${currentStore.name}`);
    await expect(page.getByRole('region', { name: `Suggested stop ${currentStore.name}` })).toContainText(product.name);
    await details.getByRole('button', { name: 'Close item details' }).click();

    await page.getByRole('button', { name: 'Finish shopping' }).click();
    const finish = page.getByRole('dialog', { name: 'Finish shopping' });
    await expect(finish.getByLabel('Where are you shopping now?')).toHaveValue(currentStore._id);
    await finish.getByRole('button', { name: 'Finish shopping', exact: true }).click();
    await expect(finish).toHaveCount(0);

    const pantryResponse = await page.request.get('/api/inventory');
    expect(pantryResponse.ok()).toBeTruthy();
    const pantry = await pantryResponse.json();
    const tracked = pantry.find(entry => String(entry.itemId?._id || entry.itemId) === String(product._id));
    expect(tracked).toBeTruthy();
    expect(tracked.quantity).toBe(4);
  });

  test('tracks an untracked List product and refreshes required demand without changing the intended purchase', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const product = await createCatalogItem(page, `PRO75 Pantry Context ${suffix}`);
    const generated = await page.request.post('/api/shopping-list/from-meal', {
      data: { items: [{ itemId: product._id, quantity: 4 }] }
    });
    expect(generated.ok()).toBeTruthy();
    const listItem = await listItemFor(page, product._id);

    await page.goto('/app/list');
    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await expect(card).toContainText('Buy 4');
    await card.getByRole('button', { name: `Open item details for ${product.name}` }).click();
    const details = page.getByRole('dialog', { name: product.name });
    await expect(details).toContainText('4 required');
    await expect(details).toContainText('Not in Pantry');
    await details.getByRole('button', { name: 'Track it?' }).click();

    const dialog = page.getByRole('dialog', { name: `Track ${product.name}` });
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toContainText('Product identified. Choose only how Pantry should track it.');
    await dialog.getByLabel('Exact quantity').check();
    await dialog.getByLabel('How many are left?').fill('2');
    await dialog.getByRole('button', { name: 'Track item' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/list/);
    await expect(details).toContainText('Pantry: 2 each on hand');
    await expect(details).toContainText('Buy 4');
    await expect(details).toContainText('2 required');

    const refreshed = await listItemFor(page, product._id);
    expect(refreshed.quantity).toBe(4);
    expect(refreshed.requiredQuantity).toBe(2);
    expect(refreshed.quantitySource).toBe('system');
  });

  test('keeps List metadata usable at mobile width and 200 percent text', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const product = await createCatalogItem(page, `PRO75 Long Metadata Product ${suffix}`);
    const store = await createStore(page, `PRO75 A Very Long Neighborhood Grocery Store ${suffix}`);
    const add = await page.request.post('/api/shopping-list', {
      data: { itemId: product._id, quantity: 2, storeId: store._id }
    });
    expect(add.ok()).toBeTruthy();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/list');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    const card = page.locator('.react-list-item', { hasText: product.name });
    await expect(card.getByRole('button', { name: `Edit quantity for ${product.name}, currently 2` })).toBeVisible();
    await card.getByRole('button', { name: `Open item details for ${product.name}` }).click();
    const details = page.getByRole('dialog', { name: product.name });
    await expect(details.getByRole('button', { name: new RegExp(`Store preference for ${product.name}`) })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});