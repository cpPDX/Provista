const { test, expect } = require('@playwright/test');

async function createHouseholdSession(page, suffix) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      name: `PRO-56 ${suffix}`,
      email: `pro56-${suffix}-${Date.now()}@test.com`,
      password: 'password123',
      action: 'create',
      householdName: `PRO-56 Household ${suffix}`
    }
  });
  expect(response.ok()).toBeTruthy();
}

test.describe('PRO-56 legacy authenticated UI retirement', () => {
  test('keeps Help & About and the App Tour inside the React shell', async ({ page }) => {
    await createHouseholdSession(page, 'HelpTour');

    await page.goto('/app/more');
    await expect(page.locator('#more-title')).toHaveText('More');
    await page.getByRole('link', { name: /Help & About/ }).click();

    await expect(page).toHaveURL(/\/app\/more\/help$/);
    await expect(page.locator('.shell-brand')).toBeVisible();
    await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#help-about-title')).toHaveText('Plan together. Shop with clarity.');
    await expect(page.getByText('Home → Plan → List → Shop → Pantry')).toBeVisible();
    await expect(page.getByText(/Add with details/)).toBeVisible();
    await expect(page.getByText(/Finish shopping/)).toBeVisible();
    await expect(page.getByText(/Simple tracking/)).toBeVisible();
    await expect(page.getByText(/Exact tracking/)).toBeVisible();
    await expect(page.getByText(/Open Prices observations are community-reported shopping context only/)).toBeVisible();
    await expect(page.locator('#section-about')).toHaveCount(0);

    // Deep links must remain React-owned after a full document reload, not just
    // while React Router is already mounted.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/more\/help$/);
    await expect(page.locator('#help-about-title')).toBeVisible();
    await expect(page.locator('.shell-brand')).toBeVisible();

    await page.getByRole('button', { name: 'Restart App Tour' }).click();
    const tour = page.getByRole('dialog', { name: 'Home / Today' });
    await expect(tour).toBeVisible();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('#tour-title')).toHaveText('Home / Today');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/plan$/);
    await expect(page.locator('#tour-title')).toHaveText('Plan');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/list$/);
    await expect(page.locator('#tour-title')).toHaveText('Shopping List');
    await expect(page.locator('#tour-text')).toContainText('Finish shopping completes one store stop at a time');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/pantry$/);
    await expect(page.locator('#tour-title')).toHaveText('Pantry');
    await expect(page.locator('#tour-text')).toContainText('simple Have, Running low, and Out tracking');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/more$/);
    await expect(page.locator('#tour-title')).toHaveText('More');
    await expect(page.locator('#tab-more')).toHaveCount(0);

    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('starts the App Tour from More without a legacy navigation', async ({ page }) => {
    await createHouseholdSession(page, 'TourEntry');

    await page.goto('/app/more');
    await page.getByRole('button', { name: /App Tour/ }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('#tour-title')).toHaveText('Home / Today');
    await expect(page.locator('.shell-brand')).toBeVisible();
    await expect(page.locator('#tab-home')).toHaveCount(0);
  });
});
