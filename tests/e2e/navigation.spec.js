const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Navigation', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
  });

  test('Home tab is active by default', async ({ page }) => {
    await expect(page.locator('#tab-home')).toHaveClass(/active/);
  });

  test('can switch to Shopping List tab', async ({ page }) => {
    await page.click('[data-tab="list"]');
    await expect(page.locator('#tab-list')).toHaveClass(/active/);
    await expect(page.locator('#tab-home')).not.toHaveClass(/active/);
  });

  test('can switch to Spend tab', async ({ page }) => {
    await page.click('[data-tab="more"]');
    await page.click('.more-item[data-section="insights"]');
    await page.click('[data-insight-tab="spend"]');
    await expect(page.locator('#tab-spend')).toHaveClass(/active/);
  });

  test('can switch to Meal Plan tab', async ({ page }) => {
    await page.click('[data-tab="meal-plan"]');
    await expect(page.locator('#tab-meal-plan')).toHaveClass(/active/);
  });

  test('More navigation opens the menu panel', async ({ page }) => {
    await page.click('[data-tab="more"]');
    await expect(page.locator('#tab-more')).toHaveClass(/active/);
  });

  test('can return Home from More', async ({ page }) => {
    await page.click('[data-tab="list"]');
    await page.click('[data-tab="more"]');
    await expect(page.locator('#tab-more')).toHaveClass(/active/);
    await page.click('[data-tab="home"]');
    await expect(page.locator('#tab-more')).not.toHaveClass(/active/);
    await expect(page.locator('#tab-home')).toHaveClass(/active/);
  });

  test('Pantry tab is visible for the household', async ({ page }) => {
    await expect(page.locator('[data-tab="inventory"]')).toBeVisible();
  });
});
