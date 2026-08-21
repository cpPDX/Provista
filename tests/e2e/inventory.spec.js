const { test, expect } = require('@playwright/test');
const { loginAsNewUser, loginAsHouseholdMember } = require('./helpers/login');

test.describe('Pantry household workflows', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.click('[data-tab="inventory"]');
  });

  test('creates a completely new item inline without losing the Pantry form', async ({ page }) => {
    const name = `Inline Pantry Item ${Date.now()}`;
    await page.click('#btn-add-inventory');
    await page.fill('#inv-item-input', name);
    const createOption = page.locator('#inv-item-dropdown .autocomplete-create');
    await expect(createOption).toContainText(`Create "${name}"`);
    await createOption.click();

    await expect(page.locator('#inv-new-item-fields')).toBeVisible();
    await page.fill('#inv-new-category', 'Pantry');
    await page.fill('#inv-new-unit', 'each');
    await page.selectOption('#inv-status', 'low');
    await page.getByRole('button', { name: 'Add to Pantry' }).click();

    await expect(page.locator('#modal-overlay')).toBeHidden();
    const card = page.locator('.pantry-card', { hasText: name });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Running low');
  });

  test('prioritizes low and out items and filters Pantry by search', async ({ page }) => {
    const suffix = Date.now();
    const names = [`Have Flour ${suffix}`, `Out Milk ${suffix}`, `Low Rice ${suffix}`];
    const itemResponses = await Promise.all(names.map(name => page.request.post('/api/items', {
      data: { name, category: 'Other', unit: 'each' }
    })));
    const items = await Promise.all(itemResponses.map(response => response.json()));
    await Promise.all([
      page.request.post('/api/inventory', { data: { itemId: items[0]._id, quantity: 2, stockStatus: 'have' } }),
      page.request.post('/api/inventory', { data: { itemId: items[1]._id, quantity: 0, stockStatus: 'out' } }),
      page.request.post('/api/inventory', { data: { itemId: items[2]._id, quantity: 1, stockStatus: 'low' } })
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

  test('lets a non-admin member mark milk low and adjust its routine quantity', async ({ page, baseURL }) => {
    const name = `Member Milk ${Date.now()}`;
    const itemResponse = await page.request.post('/api/items', {
      data: { name, category: 'Dairy', unit: 'gallon' }
    });
    const item = await itemResponse.json();
    const pantryResponse = await page.request.post('/api/inventory', {
      data: { itemId: item._id, quantity: 1, stockStatus: 'have' }
    });
    const pantry = await pantryResponse.json();
    await loginAsHouseholdMember(page, baseURL);
    await page.click('[data-tab="inventory"]');

    const card = page.locator(`.pantry-card[data-inv-id="${pantry._id}"]`);
    await expect(card).toBeVisible();
    const lowButton = card.getByRole('button', { name: 'Running low' });
    await lowButton.click();
    await expect(lowButton).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => {
      const response = await page.request.get('/api/inventory');
      return (await response.json()).find(entry => entry._id === pantry._id)?.stockStatus;
    }).toBe('low');

    await card.locator('.pantry-exact-quantity > summary').click();
    await card.getByRole('button', { name: `Increase ${name} quantity` }).click();
    await expect.poll(async () => {
      const response = await page.request.get('/api/inventory');
      return (await response.json()).find(entry => entry._id === pantry._id)?.quantity;
    }).toBe(2);
    await expect(page.locator('#btn-add-inventory')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Remove' })).toHaveCount(0);
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
    await page.getByRole('button', { name: 'Add to Pantry' }).click();

    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('.pantry-card', { hasText: name })).toContainText('Running low');
  });
});
