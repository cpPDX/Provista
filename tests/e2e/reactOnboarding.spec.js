const { test, expect } = require('@playwright/test');

async function registerHousehold(page, label) {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const email = `react-onboarding-${label}-${suffix}@test.com`;
  const password = 'password123';

  await page.goto('/login.html');
  await page.click('.auth-tab[data-mode="register"]');
  await page.fill('#register-name', `${label} Owner`);
  await page.fill('#register-email', email);
  await page.fill('#register-password', password);
  await page.click('#btn-register-continue');
  await page.click('[data-action="create"]');
  await page.fill('#household-name', `${label} Household`);
  await page.click('#btn-create-household');

  await expect(page).toHaveURL('/', { timeout: 10000 });
  await expect(page.getByRole('heading', { name: 'Who are we planning for?' })).toBeVisible({ timeout: 10000 });
  return { email, password };
}

test.describe('React action-based onboarding', () => {
  test('plans one real dinner and lands on Home with the useful outcome visible', async ({ page }) => {
    await registerHousehold(page, 'Plan First');

    await page.getByLabel('Your preferred name').fill('Chris');
    await page.getByLabel(/Add a person/).fill('Kiddo');
    await page.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText('Kiddo').first()).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'What would help right now?' })).toBeVisible();
    await page.getByRole('button', { name: /Plan tonight/ }).click();
    await expect(page).toHaveURL(/\/app\/plan\?onboarding=1$/);
    await expect(page.getByText('First useful action: plan tonight')).toBeVisible();

    const mealName = `Taco bowls ${Date.now()}`;
    const dinner = page.locator('.plan-day-today input[data-meal-name="dinner-0"]');
    await expect(dinner).toBeFocused({ timeout: 5000 });
    await dinner.fill(mealName);

    await expect(page).toHaveURL(/\/app$/, { timeout: 10000 });
    await expect(page.locator('#home-react-title')).toContainText('Chris');
    await expect(page.locator('.home-react-card', { hasText: 'What’s for dinner?' })).toContainText(mealName);

    const onboarding = await (await page.request.get('/api/onboarding')).json();
    expect(onboarding).toMatchObject({
      required: false,
      status: 'completed',
      firstAction: 'plan',
      firstUsefulAction: 'meal_planned',
      peopleSkipped: false
    });
  });

  test('adds a real grocery and lands on Home without requiring Pantry or store setup', async ({ page }) => {
    await registerHousehold(page, 'List First');

    await page.getByRole('button', { name: 'Just me for now' }).click();
    await page.getByRole('button', { name: /Build my shopping list/ }).click();
    await expect(page).toHaveURL(/\/app\/list\?onboarding=1$/);
    await expect(page.getByText('First useful action: build your shopping list')).toBeVisible();

    const input = page.locator('#react-rapid-list-input');
    await input.fill('Milk');
    await page.getByRole('button', { name: 'Add to list' }).click();
    await expect(page.locator('.react-rapid-preview')).toBeVisible();
    await page.locator('.react-rapid-preview').getByRole('button', { name: /Add 1 item/ }).click();

    await expect(page).toHaveURL(/\/app$/, { timeout: 10000 });
    const needs = page.locator('.home-react-card', { hasText: 'What do we need?' });
    await expect(needs).toContainText('Milk');

    const onboarding = await (await page.request.get('/api/onboarding')).json();
    expect(onboarding).toMatchObject({
      required: false,
      status: 'completed',
      firstAction: 'list',
      firstUsefulAction: 'list_item_added',
      peopleSkipped: true
    });
  });

  test('preserves saved setup while changing the first action and resumes after reload', async ({ page }) => {
    await registerHousehold(page, 'Resume');

    await page.getByLabel(/Add a person/).fill('Partner');
    await page.getByRole('button', { name: 'Add person' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Build my shopping list/ }).click();

    await page.getByRole('button', { name: 'Choose Plan instead' }).click();
    await expect(page.getByRole('heading', { name: 'What would help right now?' })).toBeVisible();
    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page.getByRole('heading', { name: 'Who are we planning for?' })).toBeVisible();
    await expect(page.getByText('Partner').first()).toBeVisible();

    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Plan tonight/ }).click();
    await page.reload();

    await expect(page).toHaveURL(/\/app\/plan\?onboarding=1$/);
    await expect(page.getByText('First useful action: plan tonight')).toBeVisible();
    const onboarding = await (await page.request.get('/api/onboarding')).json();
    expect(onboarding.resumeCount).toBeGreaterThanOrEqual(1);
    expect(onboarding.firstAction).toBe('plan');
  });
});
