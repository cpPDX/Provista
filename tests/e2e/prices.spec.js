const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.use({ timezoneId: 'America/Los_Angeles' });

test.describe('Price Insights', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.click('[data-tab="more"]');
    await page.click('#more-insights-prices');
    await expect(page.locator('#tab-prices')).toHaveClass(/active/);
  });

  test('Log Price opens the unified Add Grocery modal', async ({ page }) => {
    await page.click('#btn-add-price');
    await expect(page.locator('#modal-overlay')).toBeVisible();
    await expect(page.locator('#modal-title')).toContainText('Add Grocery');
    await expect(page.locator('#price-item-input')).toBeVisible();
    await expect(page.locator('#price-store-input')).toBeVisible();
    await expect(page.locator('#price-regular')).toBeVisible();
  });

  test('modal closes when X button is clicked', async ({ page }) => {
    await page.click('#btn-add-price');
    await expect(page.locator('#modal-overlay')).toBeVisible();
    await page.click('#modal-close');
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });

  test('sale and coupon options reveal their fields', async ({ page }) => {
    await page.click('#btn-add-price');
    await page.locator('#add-price-form details summary').click();

    await page.check('#price-on-sale');
    await expect(page.locator('#price-sale-group')).toBeVisible();

    await page.check('#price-coupon-used');
    await expect(page.locator('#price-coupon-group')).toBeVisible();
  });

  test('entering a price shows the live calculation preview', async ({ page }) => {
    await page.click('#btn-add-price');
    await page.fill('#price-regular', '3.99');
    await expect(page.locator('#price-calc-preview')).toBeVisible();
    await expect(page.locator('#price-calc-preview')).toContainText('3.99');
  });

  test('new grocery date defaults to the browser local calendar date', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-20T02:30:00.000Z') });
    await page.click('#btn-add-price');
    await expect(page.locator('#price-date')).toHaveValue('2026-08-19');
  });

  test('best-value callout escapes untrusted store names', async ({ page }) => {
    const html = await page.evaluate(() => buildCallout([
      { quantity: 1, price: 2, pricePerUnit: 2, item: { unit: 'each' }, store: { name: '<img src=x onerror=alert(1)>' } },
      { quantity: 1, price: 3, pricePerUnit: 3, item: { unit: 'each' }, store: { name: 'Safe Store' } }
    ]));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('catalog Add Item starts the same flow in new-item mode', async ({ page }) => {
    await page.click('[data-tab="more"]');
    await page.click('.more-item[data-section="items"]');
    await page.click('#btn-add-item-catalog');

    await expect(page.locator('#modal-title')).toContainText('Add Grocery');
    await expect(page.locator('#price-new-item')).toBeVisible();
    await expect(page.locator('#price-new-item-mode')).toHaveValue('true');
  });
});