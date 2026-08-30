const { test, expect } = require('@playwright/test');

test.describe('Authentication', () => {
  test('introduces Provista before opening account access', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Plan meals.*Shop together.*Stay ahead/ })).toBeVisible();
    await expect(page.getByText('Grocery planning for real households')).toBeVisible();

    await page.getByRole('button', { name: 'Sign in' }).first().click();
    await expect(page.locator('#auth-dialog')).toBeVisible();
    await expect(page.locator('#signin-panel')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#auth-dialog')).toBeHidden();
  });

  test('creates a household account without leaving the public page first', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Create account/ }).first().click();

    const timestamp = Date.now();
    await page.fill('#landing-signup-name', 'Splash Account User');
    await page.fill('#landing-signup-email', `e2e-splash-${timestamp}@test.com`);
    await page.fill('#landing-signup-password', 'password123');
    await page.locator('#landing-signup-form').getByRole('button', { name: 'Continue' }).click();

    await expect(page.locator('#household-panel')).toBeVisible();
    await page.getByRole('button', { name: /Create a household/ }).click();
    await page.fill('#landing-household-name', 'Splash Household');
    await page.locator('#landing-create-household-form').getByRole('button', { name: 'Create household' }).click();

    await expect(page).toHaveURL(/\/legacy-app\?onboarding=1$/, { timeout: 10000 });
    await expect(page.locator('.bottom-nav')).toBeVisible();
  });

  test('shows Sign In form by default', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('#login-form')).toBeVisible();
  });

  test('renders only the current Provista mark when legacy login markup is present', async ({ page }) => {
    await page.goto('/login.html');

    const logo = page.locator('.auth-logo-icon');
    const legacyMark = logo.locator('svg');
    await expect(logo).toBeVisible();
    await expect(legacyMark).toBeHidden();

    const brandLayer = await logo.evaluate(el => {
      const style = getComputedStyle(el, '::before');
      return { content: style.content, backgroundImage: style.backgroundImage };
    });
    expect(brandLayer.content).not.toBe('none');
    expect(brandLayer.backgroundImage).toContain('/brand/provista-mark.svg');
  });

  test('auth surface covers the full mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login.html');

    const surface = await page.evaluate(() => {
      const style = getComputedStyle(document.body);
      const rect = document.body.getBoundingClientRect();
      return {
        bodyHeight: rect.height,
        viewportHeight: window.innerHeight,
        overflowY: style.overflowY,
        backgroundImage: style.backgroundImage
      };
    });

    expect(surface.bodyHeight).toBeGreaterThanOrEqual(surface.viewportHeight - 1);
    expect(surface.overflowY).toBe('auto');
    expect(surface.backgroundImage).toContain('linear-gradient');
  });

  test('switches to Create Account tab', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('.auth-tab[data-mode="register"]');
    await expect(page.locator('#register-form')).toBeVisible();
  });

  test('registration password can be inspected and is masked by default', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('.auth-tab[data-mode="register"]');

    const password = page.locator('#register-password');
    const toggle = page.locator('#register-password-toggle');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(toggle).toHaveAttribute('aria-label', 'Show password');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await password.fill('password123');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue('password123');
    await expect(toggle).toHaveAttribute('aria-label', 'Hide password');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();
    await expect(password).toHaveAttribute('type', 'password');
    await expect(toggle).toHaveText('Show');
  });

  test('shows error for wrong credentials', async ({ page }) => {
    await page.goto('/login.html');
    await page.fill('#login-email', 'notauser@test.com');
    await page.fill('#login-password', 'wrongpass');
    await page.click('#btn-login');
    await expect(page.locator('#login-error')).toBeVisible({ timeout: 5000 });
  });

  test('registration describes the current shared household workflow', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('.auth-tab[data-mode="register"]');
    await page.fill('#register-name', 'Household Copy User');
    await page.fill('#register-email', `household-copy-${Date.now()}@test.com`);
    await page.fill('#register-password', 'password123');
    await page.click('#btn-register-continue');

    await expect(page.locator('#step-household')).toBeVisible();
    await expect(page.locator('#step-household')).toContainText('Your household shares meal plans, shopping lists, Pantry status, and shopping history.');
    await expect(page.locator('#step-household')).not.toContainText('share prices and shopping lists');
  });

  test('registers and lands on main app', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('.auth-tab[data-mode="register"]');
    const ts = Date.now();
    await page.fill('#register-name', 'E2E User');
    await page.fill('#register-email', `e2e-${ts}@test.com`);
    await page.fill('#register-password', 'password123');
    await page.click('#btn-register-continue');

    // Household setup step
    await page.click('[data-action="create"]');
    await page.fill('#household-name', 'E2E Household');
    await page.click('#btn-create-household');

    // New household owners stay on the legacy onboarding surface until PRO-55.
    await expect(page).toHaveURL(/\/legacy-app\?onboarding=1$/, { timeout: 10000 });
    await expect(page.locator('.bottom-nav')).toBeVisible();
  });

  test('recovers a forgotten password from the visible sign-in flow', async ({ page }) => {
    const email = `e2e-recovery-${Date.now()}@test.com`;
    const register = await page.request.post('/api/auth/register', {
      data: {
        name: 'Recovery User',
        email,
        password: 'password123',
        action: 'create',
        householdName: 'Recovery Household'
      }
    });
    expect(register.ok()).toBeTruthy();

    await page.goto('/login.html');
    await page.click('#forgot-password-link');
    await expect(page.locator('#step-forgot')).toBeVisible();
    await page.fill('#forgot-email', email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.locator('#forgot-message')).toContainText('reset link');
    await page.getByRole('link', { name: 'Open local reset link' }).click();

    await expect(page.locator('#step-reset')).toBeVisible();
    await page.fill('#reset-password', 'replacement456');
    await page.fill('#reset-password-confirm', 'replacement456');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.locator('#login-message')).toContainText('Password reset');
    await expect(page.locator('#login-email')).toHaveValue(email);
  });
});
