const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Inventory Tab (admin)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.click('[data-tab="inventory"]');
  });

  test('Inventory tab panel becomes active', async ({ page }) => {
    await expect(page.locator('#tab-inventory')).toHaveClass(/active/);
  });

  test('"+ Add" button opens the add inventory modal', async ({ page }) => {
    await page.click('#btn-add-inventory');
    await expect(page.locator('#modal-overlay')).toBeVisible();
  });

  test('modal closes when X button is clicked', async ({ page }) => {
    await page.click('#btn-add-inventory');
    await page.click('#modal-close');
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });
});
