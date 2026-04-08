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
});
