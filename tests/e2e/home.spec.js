const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Home / Today', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.waitForSelector('#tab-home.active');
  });

  test('opens on Home with the four household questions', async ({ page }) => {
    await expect(page.locator('#tab-home')).toHaveClass(/active/);
    const questions = page.locator('.home-question');
    await expect(questions).toHaveCount(4);
    await expect(questions).toHaveText([
      'What’s for dinner?',
      'What do we need?',
      'Is anything running low?',
      'What should I do next?'
    ]);
  });

  test('uses five parent-centered bottom navigation destinations', async ({ page }) => {
    const nav = page.locator('.bottom-nav .nav-item');
    await expect(nav).toHaveCount(5);
    await expect(nav).toHaveText(['⌂Home', '🥗Plan', '📋List', '🧺Pantry', '☰More']);
  });

  test('moves prices and spend into Insights', async ({ page }) => {
    await page.click('[data-tab="more"]');
    await page.click('.more-item[data-section="insights"]');
    await expect(page.locator('#section-insights')).toBeVisible();
    await expect(page.locator('[data-insight-tab="prices"]')).toBeVisible();
    await expect(page.locator('[data-insight-tab="spend"]')).toBeVisible();
  });

  test('quick add opens the shopping-list capture flow', async ({ page }) => {
    await page.click('#home-quick-add');
    await expect(page.locator('#tab-list')).toHaveClass(/active/);
    await expect(page.locator('#modal-overlay')).toBeVisible();
  });
});
