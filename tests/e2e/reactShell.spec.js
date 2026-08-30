const { test, expect } = require('@playwright/test');

async function createHouseholdSession(page, suffix) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      name: `React Shell ${suffix}`,
      email: `react-shell-${suffix}-${Date.now()}@test.com`,
      password: 'password123',
      action: 'create',
      householdName: `Shell Household ${suffix}`
    }
  });
  expect(response.ok()).toBeTruthy();
}

test.describe('React migration shell', () => {
  test('bootstraps the authenticated household and deep-links legacy feature tabs', async ({ page }) => {
    await createHouseholdSession(page, 'Navigation');

    await page.goto('/react-preview/');
    await expect(page.getByRole('heading', { name: 'Welcome, React Shell Navigation' })).toBeVisible();
    await expect(page.getByText('Shell Household Navigation')).toBeVisible();
    await expect(page.getByText('React now owns this shell’s authenticated session')).toBeVisible();

    await page.getByRole('button', { name: 'Pantry' }).click();
    await expect(page).toHaveURL(/\/app\?tab=inventory$/);
    await expect(page.locator('#tab-inventory')).toHaveClass(/active/);
    await expect(page.locator('#tab-inventory').getByRole('heading', { name: 'Pantry' })).toBeVisible();
  });

  test('signs out through the shared React confirmation dialog', async ({ page }) => {
    await createHouseholdSession(page, 'Logout');

    await page.goto('/react-preview/');
    await page.getByRole('button', { name: 'Sign out' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Stay signed in' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText('Grocery planning for real households')).toBeVisible();
  });
});
