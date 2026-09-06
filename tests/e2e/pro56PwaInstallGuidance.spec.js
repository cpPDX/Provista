const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function emulateIOSSafari(page, { visits = 0, standalone = false } = {}) {
  await page.addInitScript(({ visits, standalone }) => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    });
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'iPhone' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });

    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      if (query !== '(display-mode: standalone)') return originalMatchMedia(query);
      return {
        matches: standalone,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; }
      };
    };

    if (location.pathname === '/login.html') {
      localStorage.setItem('provista_visits', String(visits));
      localStorage.removeItem('installPromptDismissed');
      localStorage.removeItem('installPromptRemindAt');
    }
  }, { visits, standalone });
}

async function expectNoInstallDialogAfterDelay(page) {
  await page.waitForTimeout(1800);
  await expect(page.getByRole('dialog', { name: 'Use Provista in the store' })).toHaveCount(0);
}

test.describe('PRO-56 React PWA install guidance', () => {
  test('does not prompt on the first authenticated iOS Safari visit', async ({ page, baseURL }) => {
    await emulateIOSSafari(page, { visits: 0 });
    await loginAsReactHomeUser(page, baseURL);

    await expect(page.locator('#home-react-title')).toBeVisible();
    await expectNoInstallDialogAfterDelay(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('provista_visits'))).toBe('1');
  });

  test('offers clear iOS Home Screen steps on the second visit and respects remind later', async ({ page, baseURL }) => {
    await emulateIOSSafari(page, { visits: 1 });
    await loginAsReactHomeUser(page, baseURL);

    const dialog = page.getByRole('dialog', { name: 'Use Provista in the store' });
    await expect(dialog).toBeVisible({ timeout: 4000 });
    await expect(dialog).toContainText('Add to Home Screen');
    await expect(dialog).toContainText('Supported offline List actions');
    await expect(dialog.getByRole('button', { name: 'Remind me later' })).toBeFocused();
    await expect(page.locator('#install-sheet-overlay')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Remind me later' }).click();
    await expect(dialog).toHaveCount(0);
    const remindAt = await page.evaluate(() => Number(localStorage.getItem('installPromptRemindAt')));
    expect(remindAt).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    await page.reload();
    await expect(page.locator('#home-react-title')).toBeVisible();
    await expectNoInstallDialogAfterDelay(page);
  });

  test('allows an iOS Safari user to permanently dismiss future guidance', async ({ page, baseURL }) => {
    await emulateIOSSafari(page, { visits: 1 });
    await loginAsReactHomeUser(page, baseURL);

    const dialog = page.getByRole('dialog', { name: 'Use Provista in the store' });
    await expect(dialog).toBeVisible({ timeout: 4000 });
    await dialog.getByRole('button', { name: 'Don’t show again' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('installPromptDismissed'))).toBe('true');

    await page.reload();
    await expect(page.locator('#home-react-title')).toBeVisible();
    await expectNoInstallDialogAfterDelay(page);
  });

  test('never prompts when Provista is already running as an installed standalone app', async ({ page, baseURL }) => {
    await emulateIOSSafari(page, { visits: 4, standalone: true });
    await loginAsReactHomeUser(page, baseURL);

    await expect(page.locator('#home-react-title')).toBeVisible();
    await expectNoInstallDialogAfterDelay(page);
  });
});
