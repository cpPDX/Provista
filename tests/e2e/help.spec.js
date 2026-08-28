const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Help & About', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.waitForSelector('#tab-home.active');
    await page.click('[data-tab="more"]');
    await page.click('.more-item[data-section="about"]');
    await expect(page.locator('#section-about')).toBeVisible();
  });

  test('explains the current household workflow instead of the old price-tracker identity', async ({ page }) => {
    const help = page.locator('#about-content');

    await expect(help).toContainText('Help & About');
    await expect(help).toContainText('Home → Plan → List → Shop → Pantry');
    await expect(help).toContainText('Add with details');
    await expect(help).toContainText('Finish shopping');
    await expect(help).toContainText('Simple tracking');
    await expect(help).toContainText('Exact tracking');
    await expect(help).toContainText('Open Prices observations are community-reported shopping context only');
    await expect(help).not.toContainText('spot the best deals');
  });

  test('restarts an up-to-date App Tour from Help', async ({ page }) => {
    await page.getByRole('button', { name: 'Restart App Tour' }).click();

    await expect(page.locator('#tour-title')).toHaveText('Home / Today');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('#tour-title')).toHaveText('Plan');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('#tour-title')).toHaveText('Shopping List');
    await expect(page.locator('#tour-text')).toContainText('Finish shopping completes one store stop at a time');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('#tour-title')).toHaveText('Pantry');
    await expect(page.locator('#tour-text')).toContainText('simple Have, Running low, and Out tracking');
  });
});
