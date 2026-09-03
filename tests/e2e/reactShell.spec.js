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
  test('bootstraps the authenticated household and routes migrated feature tabs in React', async ({ page }) => {
    await createHouseholdSession(page, 'Navigation');

    await page.goto('/react-preview/');
    await expect(page.locator('#home-react-title')).toHaveText('Hi, React');
    await expect(page.locator('.shell-brand span')).toHaveText('Shell Household Navigation');
    await expect(page.locator('.home-question')).toHaveCount(4);

    await page.getByRole('button', { name: 'Pantry', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/pantry$/);
    await expect(page.locator('#pantry-react-title')).toHaveText('Pantry');
    await expect(page.getByRole('button', { name: 'Pantry', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/plan$/);
    await expect(page.locator('#plan-title')).toHaveText('Plan');
    await expect(page.getByRole('button', { name: 'Plan', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#tab-meal-plan')).toHaveCount(0);
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

  test('restores branded navigation icons and persists theme per user', async ({ page }) => {
    await createHouseholdSession(page, 'Theme');

    await page.goto('/app');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.shell-bottom-nav [data-nav-icon]')).toHaveCount(5);
    await expect(page.locator('[data-nav-icon="home"]')).toBeVisible();
    await expect(page.locator('[data-nav-icon="plan"]')).toBeVisible();
    await expect(page.locator('[data-nav-icon="list"]')).toBeVisible();
    await expect(page.locator('[data-nav-icon="pantry"]')).toBeVisible();
    await expect(page.locator('[data-nav-icon="more"]')).toBeVisible();

    const session = await page.request.get('/api/auth/me').then(response => response.json());
    const themeKey = `provista_theme_${session.user._id}`;
    const toggle = page.getByRole('button', { name: 'Switch to dark theme' });
    await toggle.click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), themeKey)).toBe('dark');
    await expect.poll(async () => {
      const response = await page.request.get('/api/auth/me');
      return (await response.json()).user.preferences.theme;
    }).toBe('dark');

    await page.evaluate(key => localStorage.removeItem(key), themeKey);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), themeKey)).toBe('dark');
  });

  test('keeps More in the React shell and preserves theme for legacy tools', async ({ page }) => {
    await createHouseholdSession(page, 'More');

    await page.goto('/app');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/more$/);
    await expect(page.locator('#more-title')).toHaveText('More');
    await expect(page.locator('.shell-brand')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.getByRole('link', { name: /My Account/ }).click();
    await expect(page).toHaveURL(/\/app\?tab=more&section=account$/);
    await expect(page.locator('#section-account')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
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
