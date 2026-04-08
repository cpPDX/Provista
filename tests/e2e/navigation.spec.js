const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Navigation', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
  });

  test('Prices tab is active by default', async ({ page }) => {
    await expect(page.locator('#tab-prices')).toHaveClass(/active/);
  });

  test('can switch to Shopping List tab', async ({ page }) => {
    await page.click('[data-tab="list"]');
    await expect(page.locator('#tab-list')).toHaveClass(/active/);
    await expect(page.locator('#tab-prices')).not.toHaveClass(/active/);
  });

  test('can switch to Spend tab', async ({ page }) => {
    await page.click('[data-tab="spend"]');
    await expect(page.locator('#tab-spend')).toHaveClass(/active/);
  });

  test('can switch to Meal Plan tab', async ({ page }) => {
    await page.click('[data-tab="meal-plan"]');
    await expect(page.locator('#tab-meal-plan')).toHaveClass(/active/);
  });

  test('hamburger menu opens the More panel', async ({ page }) => {
    await page.click('#btn-user-menu');
    await expect(page.locator('#tab-more')).toHaveClass(/active/);
  });

  test('hamburger closes menu on second click and returns to previous tab', async ({ page }) => {
    await page.click('[data-tab="list"]');
    await page.click('#btn-user-menu');
    await expect(page.locator('#tab-more')).toHaveClass(/active/);
    await page.click('#btn-user-menu');
    await expect(page.locator('#tab-more')).not.toHaveClass(/active/);
    await expect(page.locator('#tab-list')).toHaveClass(/active/);
  });

  test('Inventory tab is visible for admin/owner role', async ({ page }) => {
    await expect(page.locator('[data-tab="inventory"]')).toBeVisible();
  });
});
