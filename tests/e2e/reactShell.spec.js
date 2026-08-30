const { test, expect } = require('@playwright/test');

// Most E2E specs block service workers so route interception remains reliable.
// This spec owns the PWA smoke test, so explicitly allow the worker here.
test.use({ serviceWorkers: 'allow' });

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
    await expect(page.locator('#home-react-title')).toHaveText('Hi, React');
    await expect(page.getByText('Shell Household Navigation')).toBeVisible();
    await expect(page.locator('.home-question')).toHaveCount(4);

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

  test('keeps the production React Home shell available after going offline', async ({ page, context }) => {
    await createHouseholdSession(page, 'Offline');

    await page.goto('/app');
    await expect(page.locator('#home-react-title')).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });

    // Reload once online so the newly active worker owns the navigation and
    // caches the session plus Home API responses used by the offline reload.
    await page.reload();
    await expect(page.locator('#home-react-title')).toBeVisible();

    try {
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#home-react-title')).toBeVisible();
      await expect(page.locator('.home-question')).toHaveCount(4);
      await expect(page.locator('.home-react-stale').first()).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });
});
