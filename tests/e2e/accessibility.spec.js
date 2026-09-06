const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

test.describe('React shell accessibility', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
  });

  test('exposes clear primary navigation with mobile-sized targets', async ({ page }) => {
    const nav = page.locator('.shell-bottom-nav');
    await expect(nav).toBeVisible();

    for (const name of ['Home', 'Plan', 'List', 'Pantry', 'More']) {
      const button = nav.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box, `${name} navigation target`).not.toBeNull();
      expect(box.height, `${name} navigation height`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${name} navigation width`).toBeGreaterThanOrEqual(44);
    }

    await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
  });

  test('keeps each primary React destination named and horizontally contained', async ({ page }) => {
    const destinations = [
      ['Plan', '#plan-title'],
      ['List', '#react-list-title'],
      ['Pantry', '#pantry-react-title'],
      ['More', '#more-title']
    ];

    for (const [name, heading] of destinations) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator(heading)).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });

  test('keeps destructive confirmation modal, focused, keyboard-dismissible, and focus-restoring', async ({ page }) => {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const signOut = page.getByRole('button', { name: 'Sign out' });
    await signOut.focus();
    await signOut.click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('button', { name: 'Stay signed in' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(signOut).toBeFocused();
  });
});
