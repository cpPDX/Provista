const { test, expect } = require('@playwright/test');

async function createHouseholdSession(page, suffix) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      name: `Shell Hardening ${suffix}`,
      email: `shell-hardening-${suffix}-${Date.now()}@test.com`,
      password: 'password123',
      action: 'create',
      householdName: `Shell Hardening ${suffix}`
    }
  });
  expect(response.ok()).toBeTruthy();
}

test.describe('PRO-73 and PRO-84 mobile shell hardening', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps theme switching functional while removing Sign out from mobile chrome', async ({ page }) => {
    await createHouseholdSession(page, 'Mobile');
    await page.goto('/app');

    const header = page.locator('.shell-header');
    const themeToggle = page.getByRole('button', { name: 'Switch to dark theme' });
    await expect(themeToggle).toBeVisible();
    await expect(header.getByRole('button', { name: 'Sign out' })).toBeHidden();

    const headerHeight = await header.evaluate(element => element.getBoundingClientRect().height);
    expect(headerHeight).toBeLessThanOrEqual(64);

    await themeToggle.tap();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();

    await page.getByRole('button', { name: 'More', exact: true }).tap();
    await expect(page).toHaveURL(/\/app\/more$/);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
