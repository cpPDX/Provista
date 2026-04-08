const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Prices Tab', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    // Make sure we're on Prices tab
    await page.click('[data-tab="prices"]');
  });

  test('"+ Log Price" button opens the Log Price modal', async ({ page }) => {
    await page.click('#btn-add-price');
    await expect(page.locator('#modal-overlay')).toBeVisible();
    await expect(page.locator('#modal-title')).toContainText('Log Price');
  });

  test('modal closes when X button is clicked', async ({ page }) => {
    await page.click('#btn-add-price');
    await expect(page.locator('#modal-overlay')).toBeVisible();
    await page.click('#modal-close');
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });

  test('"On Sale" checkbox reveals sale price field', async ({ page }) => {
    await page.click('#btn-add-price');
    await page.check('#price-on-sale');
    await expect(page.locator('#price-sale-group')).toBeVisible();
  });

  test('"Used Coupon" checkbox reveals coupon fields', async ({ page }) => {
    await page.click('#btn-add-price');
    await page.check('#price-coupon-used');
    await expect(page.locator('#price-coupon-group')).toBeVisible();
  });

  test('entering regular price shows price preview', async ({ page }) => {
    await page.click('#btn-add-price');
    await page.fill('#price-regular', '3.99');
    await expect(page.locator('#price-calc-preview')).toBeVisible();
    await expect(page.locator('#price-calc-preview')).toContainText('3.99');
  });
});
