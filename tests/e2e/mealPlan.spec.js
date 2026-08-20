const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Meal Plan Tab', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.click('[data-tab="meal-plan"]');
    await page.waitForSelector('.meal-day', { timeout: 10000 });
  });

  test('Meal Plan tab panel becomes active', async ({ page }) => {
    await expect(page.locator('#tab-meal-plan')).toHaveClass(/active/);
  });

  test('week navigation buttons are visible', async ({ page }) => {
    await expect(page.locator('#mp-prev-week')).toBeVisible();
    await expect(page.locator('#mp-next-week')).toBeVisible();
  });

  test('meal plan content loads with seven day cards', async ({ page }) => {
    await expect(page.locator('#meal-plan-content')).toBeVisible();
    await expect(page.locator('.meal-day')).toHaveCount(7);
  });

  test('each day starts with four meal type sections and Everyone audiences', async ({ page }) => {
    const dayCard = page.locator('.meal-day').first();
    await expect(dayCard.locator('.meal-type-section')).toHaveCount(4);

    const audienceButtons = dayCard.locator('.meal-audience-toggle');
    await expect(audienceButtons).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(audienceButtons.nth(i)).toHaveText('Everyone');
    }
  });

  test('meal rows include an optional notes field', async ({ page }) => {
    const firstRow = page.locator('.meal-row').first();
    await expect(firstRow.locator('.meal-name-input')).toBeVisible();
    await expect(firstRow.locator('.meal-notes-input')).toBeVisible();
  });

  test('prev/next week nav changes the week label', async ({ page }) => {
    const label = page.locator('.meal-plan-week-label');
    const beforeText = await label.textContent();
    await page.click('#mp-next-week');
    await page.waitForFunction(
      previous => document.querySelector('.meal-plan-week-label')?.textContent !== previous,
      beforeText
    );
    await expect(label).not.toHaveText(beforeText);
  });
});
