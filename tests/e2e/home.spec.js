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
    await expect(nav.locator(':scope > span:nth-child(2)')).toHaveText(['Home', 'Plan', 'List', 'Pantry', 'More']);
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

  test('keeps the other Home cards useful when one endpoint fails', async ({ page }) => {
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(key => key.includes('provista_home_') && key.endsWith('_lowStock'))
        .forEach(key => localStorage.removeItem(key));
    });
    await page.route('**/api/inventory/low-stock', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporarily unavailable' })
    }));
    await page.reload();

    await expect(page.locator('.home-card')).toHaveCount(4);
    await expect(page.locator('.home-card', { hasText: 'Couldn’t load this update' })).toHaveCount(1);
    await expect(page.locator('.home-card', { hasText: 'What’s for dinner?' })).not.toContainText('Couldn’t load');
    await expect(page.locator('.home-card', { hasText: 'What do we need?' })).not.toContainText('Couldn’t load');
  });

  test('Plan dinner opens today, focuses dinner, and accepts tonight’s meal', async ({ page }) => {
    await page.click('#home-plan-dinner');
    await expect(page.locator('#tab-meal-plan')).toHaveClass(/active/);
    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const todayCard = page.locator(`.meal-day[data-date^="${today}"]`);
    await expect(todayCard).toHaveAttribute('data-expanded', 'true');
    const dinner = todayCard.locator('.meal-type-section[data-meal-type="dinner"] .meal-name-input').first();
    await expect(dinner).toBeFocused();
    await dinner.fill('Tonight’s quick dinner');
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓', { timeout: 10000 });
  });
});
