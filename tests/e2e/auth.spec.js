const { test, expect } = require('@playwright/test');

test.describe('Authentication', () => {
  test('shows Sign In form by default', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page.locator('#login-form')).toBeVisible();
  });

  test('switches to Create Account tab', async ({ page }) => {
    await page.goto('/login.html');
    await page.click('.auth-tab[data-mode="register"]');
    await expect(page.locator('#register-form')).toBeVisible();
  });

  test('shows error for wrong credentials', async ({ page }) => {
    await page.goto('/login.html');
    await page.fill('#login-email', 'notauser@test.com');
    await page.fill('#login-password', 'wrongpass');
    await page.click('#btn-login');
    await expect(page.locator('#login-error')).toBeVisible({ timeout: 5000 });
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

    // Should land on main app
    await expect(page).toHaveURL('/', { timeout: 10000 });
    await expect(page.locator('#tab-home')).toBeVisible();
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
