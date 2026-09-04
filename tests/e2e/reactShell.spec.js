const { test, expect } = require('@playwright/test');

// Most E2E specs block service workers so route interception remains reliable.
// This spec owns the PWA smoke test, so explicitly allow the worker here.
test.use({ serviceWorkers: 'allow' });

function parseRgb(value) {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Could not parse color: ${value}`);
  return channels;
}

function relativeLuminance(rgb) {
  const channels = rgb.map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(parseRgb(first)), relativeLuminance(parseRgb(second)));
  const darker = Math.min(relativeLuminance(parseRgb(first)), relativeLuminance(parseRgb(second)));
  return (lighter + 0.05) / (darker + 0.05);
}

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

async function createListItem(page, suffix) {
  const itemResponse = await page.request.post('/api/items', {
    data: { name: `Theme checkout ${suffix}`, category: 'Other', unit: 'each' }
  });
  expect(itemResponse.ok()).toBeTruthy();
  const item = await itemResponse.json();
  const listResponse = await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity: 1 }
  });
  expect(listResponse.ok()).toBeTruthy();
  return item;
}

async function checkoutThemeState(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.react-checkout-modal');
    const title = document.querySelector('#react-checkout-title');
    const eyebrow = dialog?.querySelector('.react-list-eyebrow');
    const store = document.querySelector('#parent-trip-store');
    const finish = document.querySelector('#parent-finish-shopping');
    if (!dialog || !title || !eyebrow || !store || !finish) throw new Error('Checkout theme fixtures are missing');
    const dialogStyle = getComputedStyle(dialog);
    const titleStyle = getComputedStyle(title);
    const eyebrowStyle = getComputedStyle(eyebrow);
    const storeStyle = getComputedStyle(store);
    const finishStyle = getComputedStyle(finish);
    return {
      dialogBackground: dialogStyle.backgroundColor,
      dialogText: dialogStyle.color,
      titleText: titleStyle.color,
      eyebrowText: eyebrowStyle.color,
      storeBackground: storeStyle.backgroundColor,
      storeText: storeStyle.color,
      storeOutlineStyle: storeStyle.outlineStyle,
      storeOutlineWidth: storeStyle.outlineWidth,
      finishBackground: finishStyle.backgroundColor,
      finishText: finishStyle.color
    };
  });
}

function expectCheckoutContrast(colors) {
  expect(contrastRatio(colors.dialogText, colors.dialogBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.titleText, colors.dialogBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.eyebrowText, colors.dialogBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.storeText, colors.storeBackground)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(colors.finishText, colors.finishBackground)).toBeGreaterThanOrEqual(4.5);
  expect(colors.storeOutlineStyle).not.toBe('none');
  expect(parseFloat(colors.storeOutlineWidth)).toBeGreaterThanOrEqual(3);
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
    const moonMetrics = await toggle.evaluate(button => {
      const svg = button.querySelector('svg');
      const path = svg?.querySelector('path');
      if (!svg || !path) throw new Error('Theme moon icon is missing');
      const buttonRect = button.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      return {
        fill: getComputedStyle(path).fill,
        dx: Math.abs((buttonRect.left + buttonRect.width / 2) - (svgRect.left + svgRect.width / 2)),
        dy: Math.abs((buttonRect.top + buttonRect.height / 2) - (svgRect.top + svgRect.height / 2))
      };
    });
    expect(moonMetrics.fill).not.toBe('none');
    expect(moonMetrics.fill).not.toBe('rgba(0, 0, 0, 0)');
    expect(moonMetrics.dx).toBeLessThanOrEqual(1);
    expect(moonMetrics.dy).toBeLessThanOrEqual(1);

    await toggle.click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const lightToggle = page.getByRole('button', { name: 'Switch to light theme' });
    await expect(lightToggle).toBeVisible();
    await expect(lightToggle.locator('svg circle')).toHaveCount(1);
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

  test('keeps Finish shopping readable when theme changes while the modal is open', async ({ page }) => {
    await createHouseholdSession(page, 'CheckoutTheme');
    const item = await createListItem(page, `${Date.now()}-${test.info().workerIndex}`);

    await page.goto('/app/list');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: `Mark as purchased ${item.name}` }).click();
    await page.locator('#btn-done-shopping').click();

    const dialog = page.getByRole('dialog', { name: 'Finish shopping' });
    const store = dialog.locator('#parent-trip-store');
    await expect(dialog).toBeVisible();
    await expect(store).toBeFocused();

    const lightColors = await checkoutThemeState(page);
    expectCheckoutContrast(lightColors);

    await page.locator('.shell-theme-toggle').evaluate(button => button.click());
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(store).toBeFocused();

    const darkColors = await checkoutThemeState(page);
    expectCheckoutContrast(darkColors);
    expect(darkColors.dialogBackground).not.toBe(lightColors.dialogBackground);
    expect(darkColors.dialogText).not.toBe(lightColors.dialogText);
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
