const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('User Menu (hamburger)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.click('#btn-user-menu');
    await expect(page.locator('#tab-more')).toHaveClass(/active/);
  });

  test('My Account menu item opens account sub-section', async ({ page }) => {
    await page.click('[data-section="account"]');
    await expect(page.locator('#section-account')).toBeVisible();
  });

  test('profile form is pre-filled with user name', async ({ page }) => {
    await page.click('[data-section="account"]');
    const nameVal = await page.locator('#profile-name').inputValue();
    expect(nameVal.length).toBeGreaterThan(0);
  });

  test('Household menu item opens household sub-section', async ({ page }) => {
    await page.click('[data-section="household"]');
    await expect(page.locator('#section-household')).toBeVisible();
  });

  test('back button returns to more menu from sub-section', async ({ page }) => {
    await page.click('[data-section="household"]');
    await expect(page.locator('#section-household')).toBeVisible();
    await page.click('#section-household .back-btn');
    await expect(page.locator('.more-menu')).toBeVisible();
  });

  test('About menu item opens About sub-section', async ({ page }) => {
    await page.click('[data-section="about"]');
    await expect(page.locator('#section-about')).toBeVisible();
    await expect(page.locator('#section-about')).toContainText('Chris Phelan');
  });

  test('Product Catalog menu item visible for admin/owner', async ({ page }) => {
    await expect(page.locator('[data-section="items"]')).toBeVisible();
  });
});
