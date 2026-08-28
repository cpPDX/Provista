const { test, expect } = require('@playwright/test');
const { loginAsNewUser, loginAsHouseholdMember } = require('./helpers/login');

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

test.describe('Pantry household workflows', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.click('[data-tab="inventory"]');
  });

  test('creates a new simple-tracked item inline without losing the Pantry form', async ({ page }) => {
    const name = `Inline Pantry Item ${Date.now()}`;
    await page.click('#btn-add-inventory');
    await expect(page.locator('#modal-title')).toHaveText('Track an item');
    await page.fill('#inv-item-input', name);
    const createOption = page.locator('#inv-item-dropdown .autocomplete-create');
    await expect(createOption).toContainText(`Create "${name}"`);
    await createOption.click();

    await expect(page.locator('#inv-new-item-fields')).toBeVisible();
    await page.fill('#inv-new-category', 'Pantry');
    await page.fill('#inv-new-unit', 'each');
    await expect(page.locator('input[name="inv-tracking-mode"][value="simple"]')).toBeChecked();
    await page.selectOption('#inv-status', 'low');
    await page.getByRole('button', { name: 'Track item', exact: true }).click();

    await expect(page.locator('#modal-overlay')).toBeHidden();
    const card = page.locator('.pantry-card', { hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Running low');
    await expect(card).not.toContainText('Running low and Out items appear on Home');
    await expect(card).not.toContainText('Track an exact quantity instead');
    await expect(card.locator('.pantry-qty-controls')).toHaveCount(0);
    await expect(page.locator('#pantry-page-help')).toHaveText('Mark staples Running low or Out and Provista will surface them on Home and in List review.');
  });

  test('prioritizes low and out items on a fresh load and filters Pantry by search', async ({ page }) => {
    const suffix = Date.now();
    const names = [`Have Flour ${suffix}`, `Out Milk ${suffix}`, `Low Rice ${suffix}`];
    const items = await Promise.all(names.map(name => createItem(page, name)));
    await Promise.all([
      createPantryItem(page, items[0], { trackingMode: 'simple', stockStatus: 'have' }),
      createPantryItem(page, items[1], { trackingMode: 'simple', stockStatus: 'out' }),
      createPantryItem(page, items[2], { trackingMode: 'simple', stockStatus: 'low' })
    ]);
    await page.click('[data-tab="home"]');
    await page.click('[data-tab="inventory"]');

    const relevantCards = page.locator('.pantry-card').filter({ hasText: new RegExp(String(suffix)) });
    await expect(relevantCards).toHaveCount(3);
    await expect(relevantCards.nth(0)).toContainText('Out Milk');
    await expect(relevantCards.nth(1)).toContainText('Low Rice');

    await page.fill('#pantry-search', `Have Flour ${suffix}`);
    await expect(page.locator('.pantry-card')).toHaveCount(1);
    await expect(page.locator('.pantry-card')).toContainText(`Have Flour ${suffix}`);
  });

  test('keeps a simple status control under the user instead of re-sorting mid-action', async ({ page, baseURL }) => {
    const suffix = Date.now();
    const firstItem = await createItem(page, `Stable First ${suffix}`);
    const secondItem = await createItem(page, `Stable Second ${suffix}`);
    const first = await createPantryItem(page, firstItem, { trackingMode: 'simple', stockStatus: 'have' });
    const second = await createPantryItem(page, secondItem, { trackingMode: 'simple', stockStatus: 'have' });

    await loginAsHouseholdMember(page, baseURL);
    await page.click('[data-tab="inventory"]');
    const before = await page.locator('.pantry-card').evaluateAll(cards => cards.map(card => card.dataset.invId));
    const targetId = before[before.length - 1] === first._id ? first._id : second._id;
    const card = page.locator(`.pantry-card[data-inv-id="${targetId}"]`);
    const lowButton = card.getByRole('button', { name: 'Running low' });

    await lowButton.click();
    await expect(lowButton).toHaveAttribute('aria-pressed', 'true');
    await expect(lowButton).toBeFocused();
    const after = await page.locator('.pantry-card').evaluateAll(cards => cards.map(card => card.dataset.invId));
    expect(after).toEqual(before);

    await expect.poll(async () => {
      const response = await page.request.get('/api/inventory');
      return (await response.json()).find(entry => entry._id === targetId)?.stockStatus;
    }).toBe('low');

    await page.click('[data-tab="home"]');
    await page.click('[data-tab="inventory"]');
    const stableCards = page.locator('.pantry-card').filter({ hasText: new RegExp(`Stable (First|Second) ${suffix}`) });
    await expect(stableCards).toHaveCount(2);
    await expect(stableCards.first()).toHaveAttribute('data-inv-id', targetId);
  });

  test('lets exact quantity be tapped repeatedly without collapsing or moving the control', async ({ page, baseURL }) => {
    const name = `Exact Cans ${Date.now()}`;
    const item = await createItem(page, name, 'can');
    const pantry = await createPantryItem(page, item, {
      trackingMode: 'exact',
      quantity: 1,
      lowStockThreshold: 1
    });

    await loginAsHouseholdMember(page, baseURL);
    await page.click('[data-tab="inventory"]');
    const card = page.locator(`.pantry-card[data-inv-id="${pantry._id}"]`);
    const increase = card.getByRole('button', { name: `Increase ${name} quantity` });
    await expect(card).toHaveAttribute('data-tracking-mode', 'exact');
    await expect(card.locator('.pantry-status-actions')).toHaveCount(0);

    await increase.click();
    await increase.click();
    await increase.click();

    await expect(card.locator('.qty-val')).toHaveText('4');
    await expect(increase).toBeVisible();
    await expect(increase).toBeFocused();
    await expect(card).toContainText('4 can left');
    await expect.poll(async () => {
      const response = await page.request.get('/api/inventory');
      return (await response.json()).find(entry => entry._id === pantry._id)?.quantity;
    }, { timeout: 5000 }).toBe(4);
  });

  test('keeps simple and exact tracking mutually exclusive and moves mode changes into Edit details', async ({ page }) => {
    const suffix = Date.now();
    const simpleItem = await createItem(page, `Simple Milk ${suffix}`);
    const exactItem = await createItem(page, `Exact Milk ${suffix}`);
    const simple = await createPantryItem(page, simpleItem, { trackingMode: 'simple', stockStatus: 'low' });
    const exact = await createPantryItem(page, exactItem, { trackingMode: 'exact', quantity: 3, lowStockThreshold: 2 });

    await page.click('[data-tab="home"]');
    await page.click('[data-tab="inventory"]');
    const simpleCard = page.locator(`.pantry-card[data-inv-id="${simple._id}"]`);
    const exactCard = page.locator(`.pantry-card[data-inv-id="${exact._id}"]`);

    await expect(simpleCard.locator('.pantry-status-actions')).toBeVisible();
    await expect(simpleCard.locator('.pantry-qty-controls')).toHaveCount(0);
    await expect(simpleCard).not.toContainText('Track an exact quantity instead');
    await expect(exactCard.locator('.pantry-qty-controls')).toBeVisible();
    await expect(exactCard.locator('.pantry-status-actions')).toHaveCount(0);
    await expect(exactCard).toContainText('Provista marks low at 2');

    await simpleCard.getByRole('button', { name: 'Edit details' }).click();
    await expect(page.locator('input[name="edit-inv-tracking-mode"][value="simple"]')).toBeChecked();
    await expect(page.locator('input[name="edit-inv-tracking-mode"][value="exact"]')).toBeVisible();
  });

  test('shows meaningful low-stock review state and makes On list static', async ({ page }) => {
    const suffix = Date.now();
    const simpleItem = await createItem(page, `Simple Low ${suffix}`);
    const exactItem = await createItem(page, `Exact Low ${suffix}`, 'can');
    await createPantryItem(page, simpleItem, { trackingMode: 'simple', stockStatus: 'low' });
    await createPantryItem(page, exactItem, { trackingMode: 'exact', quantity: 2, lowStockThreshold: 3 });
    await page.request.post('/api/shopping-list', { data: { itemId: simpleItem._id, quantity: 1 } });

    await page.click('[data-tab="list"]');
    await expect(page.locator('#btn-low-stock')).toBeVisible();
    await page.locator('#btn-low-stock').click();
    const simpleRow = page.locator('#low-stock-list .card', { hasText: simpleItem.name });
    const exactRow = page.locator('#low-stock-list .card', { hasText: exactItem.name });

    await expect(simpleRow).toContainText('Running low');
    await expect(simpleRow).not.toContainText('null');
    await expect(simpleRow).toContainText('On list ✓');
    await expect(simpleRow.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(exactRow).toContainText('2 can left · low at 3 can');
    await expect(exactRow.locator('input[type="checkbox"]')).toHaveCount(1);
  });

  test('lets a non-admin member create a new item inline from Pantry', async ({ page, baseURL }) => {
    await loginAsHouseholdMember(page, baseURL);
    await page.click('[data-tab="inventory"]');
    const name = `Member Pantry Item ${Date.now()}`;
    await page.click('#btn-add-inventory');
    await page.fill('#inv-item-input', name);
    await page.locator('#inv-item-dropdown .autocomplete-create').click();
    await page.fill('#inv-new-category', 'Pantry');
    await page.fill('#inv-new-unit', 'each');
    await page.selectOption('#inv-status', 'low');
    await page.getByRole('button', { name: 'Track item', exact: true }).click();

    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('.pantry-card', { hasText: name })).toContainText('Running low');
    await expect(page.locator('.pantry-card', { hasText: name }).getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });
});
