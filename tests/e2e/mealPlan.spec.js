const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Meal Plan Tab', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.click('[data-tab="meal-plan"]');
  });

  test('Meal Plan tab panel becomes active', async ({ page }) => {
    await expect(page.locator('#tab-meal-plan')).toHaveClass(/active/);
  });

  test('week navigation buttons are visible', async ({ page }) => {
    await expect(page.locator('#btn-prev-week')).toBeVisible();
    await expect(page.locator('#btn-next-week')).toBeVisible();
  });

  test('meal plan content loads with day cards', async ({ page }) => {
    // Wait for the meal plan to load
    await expect(page.locator('#meal-plan-content')).toBeVisible();
    await expect(page.locator('.day-card').first()).toBeVisible({ timeout: 10000 });
  });

  test('each day card has at least 4 meal type sections', async ({ page }) => {
    await page.waitForSelector('.day-card', { timeout: 10000 });
    const dayCard = page.locator('.day-card').first();
    const sections = dayCard.locator('.meal-type-section');
    await expect(sections).toHaveCount(4);
  });

  test('prev/next week nav changes the week label', async ({ page }) => {
    await page.waitForSelector('#week-label', { timeout: 10000 });
    const beforeText = await page.locator('#week-label').textContent();
    await page.click('#btn-next-week');
    await page.waitForTimeout(500);
    const afterText = await page.locator('#week-label').textContent();
    expect(afterText).not.toBe(beforeText);
  });
});
