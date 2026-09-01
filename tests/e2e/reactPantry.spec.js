const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createItem(page, name, unit = 'each') {
  const response = await page.request.post('/api/items', {
    data: { name, category: 'Other', unit }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createPantryItem(page, item, data = {}) {
  const response = await page.request.post('/api/inventory', {
    data: { itemId: item._id, unit: item.unit || 'each', ...data }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openReactPantry(page) {
  await page.getByRole('button', { name: 'Pantry', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/pantry$/);
  await expect(page.locator('#pantry-react-title')).toHaveText('Pantry');
}

test.describe('React Pantry migration', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
  });

  test('creates a new simple-tracked product without leaving the Pantry dialog', async ({ page }) => {
    const name = `React Pantry Item ${Date.now()}`;
    await openReactPantry(page);

    await page.getByRole('button', { name: 'Track item', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Track an item' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('What do you want to track?')).toBeFocused();
    await dialog.getByLabel('What do you want to track?').fill(name);
    await dialog.getByLabel('Category').fill('Pantry');
    await dialog.getByLabel('Unit').fill('each');
    await dialog.getByLabel('What do you have right now?').selectOption('low');
    await dialog.getByRole('button', { name: 'Track item', exact: true }).click();

    await expect(dialog).toBeHidden();
    const card = page.locator('.pantry-card', { hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Running low');
    await expect(card.locator('.pantry-status-actions')).toBeVisible();
    await expect(card.locator('.pantry-qty-controls')).toHaveCount(0);
  });

  test('coalesces repeated exact-quantity taps without moving the control', async ({ page }) => {
    const name = `React Exact Cans ${Date.now()}`;
    const product = await createItem(page, name, 'can');
    const pantry = await createPantryItem(page, product, {
      trackingMode: 'exact',
      quantity: 1,
      lowStockThreshold: 1
    });
    await openReactPantry(page);

    const card = page.locator(`.pantry-card[data-inv-id="${pantry._id}"]`);
    const increase = card.getByRole('button', { name: `Increase ${name} quantity` });
    await expect(card).toHaveAttribute('data-tracking-mode', 'exact');

    await page.evaluate(id => {
      const cardElement = document.querySelector(`.pantry-card[data-inv-id="${id}"]`);
      const button = cardElement?.querySelector('button[aria-label^="Increase "]');
      if (!(button instanceof HTMLButtonElement)) throw new Error('Increase control is not available');
      button.click();
      button.click();
      button.click();
      button.focus();
    }, pantry._id);

    await expect(card.locator('.qty-val')).toHaveText('4');
    await expect(increase).toBeVisible();
    await expect(increase).toBeFocused();
    await expect(card).toContainText('4 can left');
    await expect.poll(async () => {
      const response = await page.request.get('/api/inventory');
      const items = await response.json();
      return items.find(entry => entry._id === pantry._id)?.quantity;
    }, { timeout: 5000 }).toBe(4);
  });

  test('edits tracking details and removes Pantry items through React', async ({ page }) => {
    const name = `React Remove Item ${Date.now()}`;
    const product = await createItem(page, name);
    const pantry = await createPantryItem(page, product, {
      trackingMode: 'simple',
      stockStatus: 'have'
    });
    await openReactPantry(page);

    const card = page.locator(`.pantry-card[data-inv-id="${pantry._id}"]`);
    const editButton = card.getByRole('button', { name: 'Edit details' });
    await editButton.click();
    const editDialog = page.getByRole('dialog', { name: `Track ${name}` });
    await expect(editDialog.getByRole('button', { name: `Close Track ${name}` })).toBeFocused();
    await editDialog.getByLabel('Exact quantity').check();
    await editDialog.getByLabel('How many are left?').fill('3');
    await editDialog.getByLabel(/Mark Running low at or below/).fill('2');
    await editDialog.getByRole('button', { name: 'Save tracking' }).click();

    await expect(editDialog).toBeHidden();
    await expect(editButton).toBeFocused();
    await expect(card).toHaveAttribute('data-tracking-mode', 'exact');
    await expect(card.locator('.qty-val')).toHaveText('3');
    await expect(card).toContainText('Provista marks low at 2');

    await card.getByRole('button', { name: 'Remove' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Remove from Pantry?');
    await confirm.getByRole('button', { name: 'Remove from Pantry' }).click();
    await expect(card).toHaveCount(0);

    await expect.poll(async () => {
      const response = await page.request.get('/api/inventory');
      const items = await response.json();
      return items.some(entry => entry._id === pantry._id);
    }).toBe(false);
  });

  test('opens low-stock review from React List without falling back to legacy', async ({ page }) => {
    await page.goto('/app/list');
    await page.getByText('More shopping tools').click();
    await page.getByRole('button', { name: 'Review low stock' }).click();

    await expect(page).toHaveURL(/\/app\/pantry$/);
    await expect(page.locator('#pantry-react-title')).toHaveText('Pantry');
    await expect(page.locator('#tab-inventory')).toHaveCount(0);
  });
});
