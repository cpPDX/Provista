const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

test.describe('PRO-72 mobile Plan reflow', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps every meal and audience target reachable without hidden horizontal scrolling', async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    await page.goto('/app/plan');

    const mealTypes = page.locator('.plan-meal-type-selector');
    const groups = page.locator('.plan-audience-status-list');
    await expect(mealTypes).toBeVisible();
    await expect(groups).toBeVisible();
    await expect(groups.getByRole('button', { name: '+ Separate group' })).toBeVisible();

    const layout = await page.evaluate(() => {
      const measure = selector => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`${selector} missing`);
        const buttons = [...element.querySelectorAll('button')];
        const viewportWidth = document.documentElement.clientWidth;
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          buttons: buttons.map(button => {
            const rect = button.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width, viewportWidth };
          })
        };
      };
      return { mealTypes: measure('.plan-meal-type-selector'), groups: measure('.plan-audience-status-list') };
    });

    for (const section of [layout.mealTypes, layout.groups]) {
      expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth + 1);
      for (const button of section.buttons) {
        expect(button.left).toBeGreaterThanOrEqual(-1);
        expect(button.right).toBeLessThanOrEqual(button.viewportWidth + 1);
        expect(button.width).toBeGreaterThan(0);
      }
    }

    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await expect(groups.getByRole('button', { name: '+ Separate group' })).toBeVisible();
    const at200 = await groups.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(at200.scrollWidth).toBeLessThanOrEqual(at200.clientWidth + 1);
  });
});
