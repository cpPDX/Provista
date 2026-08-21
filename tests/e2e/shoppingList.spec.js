const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Shopping List Tab', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.click('[data-tab="list"]');
  });

  test('"+ Add" button opens the add item modal', async ({ page }) => {
    await page.click('#btn-add-list-item');
    await expect(page.locator('#modal-overlay')).toBeVisible();
  });

  test('modal closes when X button is clicked', async ({ page }) => {
    await page.click('#btn-add-list-item');
    await page.click('#modal-close');
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });

  test('"Clear Checked" button is visible', async ({ page }) => {
    await expect(page.locator('#btn-clear-checked')).toBeVisible();
  });

  test('"Clear All" button is visible for admin/owner', async ({ page }) => {
    await expect(page.locator('#btn-clear-all')).toBeVisible();
  });

  test('checking an item is instant and defers missing prices to trip review', async ({ page }) => {
    const itemResponse = await page.request.post('/api/items', {
      data: { name: `Instant Check ${Date.now()}`, category: 'Other', unit: 'each' }
    });
    expect(itemResponse.ok()).toBeTruthy();
    const item = await itemResponse.json();
    const listResponse = await page.request.post('/api/shopping-list', {
      data: { itemId: item._id, quantity: 1 }
    });
    expect(listResponse.ok()).toBeTruthy();

    await page.click('[data-tab="home"]');
    await page.click('[data-tab="list"]');
    const card = page.locator(`.list-item[data-id="${(await listResponse.json())._id}"]`);
    await card.locator('.list-item-check-wrap').click();

    await expect(card).toHaveClass(/checked/);
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('#cart-bar-label')).toContainText('1 need price');

    await page.click('#cart-bar-summary');
    await page.click('#btn-done-shopping');
    await expect(page.locator('#modal-title')).toHaveText('Review shopping trip');
    await expect(page.locator('.trip-review-warning')).toContainText('1 item needs prices');
  });
});
