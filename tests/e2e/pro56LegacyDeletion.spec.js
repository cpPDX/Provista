const { test, expect } = require('@playwright/test');

async function createHouseholdSession(page, suffix) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      name: `PRO-56 deletion ${suffix}`,
      email: `pro56-deletion-${suffix}-${Date.now()}@test.com`,
      password: 'password123',
      action: 'create',
      householdName: `PRO-56 deletion ${suffix}`
    }
  });
  expect(response.ok()).toBeTruthy();
}

test.describe('PRO-56 final legacy shell deletion', () => {
  test('redirects migration-era bookmarks into React without rendering legacy UI', async ({ page }) => {
    await createHouseholdSession(page, 'redirects');

    await page.goto('/app?tab=list');
    await expect(page).toHaveURL(/\/app\/list$/);
    await expect(page.locator('#shopping-list-react-title')).toBeVisible();
    await expect(page.locator('#tab-list')).toHaveCount(0);

    await page.goto('/app?tab=more&section=items');
    await expect(page).toHaveURL(/\/app\/more\/products$/);
    await expect(page.locator('#product-catalog-title')).toBeVisible();
    await expect(page.locator('#section-items')).toHaveCount(0);

    await page.goto('/app?tab=more&action=csv-import');
    await expect(page).toHaveURL(/\/app\/more\/import$/);
    await expect(page.locator('#import-prices-title')).toBeVisible();

    await page.goto('/legacy-app');
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('#home-react-title')).toBeVisible();
  });

  test('does not expose retired authenticated assets or cache them in the service worker', async ({ page }) => {
    const retired = [
      '/index.html',
      '/js/app.js',
      '/js/auth.js',
      '/js/offline.js',
      '/js/install-prompt.js',
      '/js/scanner.js',
      '/js/vendor/idb.min.js',
      '/css/parentExperience.css',
      '/css/rapidShoppingCapture.css'
    ];

    for (const path of retired) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(404);
    }

    const worker = await page.request.get('/sw.js');
    expect(worker.ok()).toBeTruthy();
    const workerSource = await worker.text();
    expect(workerSource).toContain("provista-shell-v15");
    expect(workerSource).not.toContain("'/index.html'");
    expect(workerSource).not.toContain("'/legacy-app'");
    expect(workerSource).not.toContain("'/js/app.js'");
    expect(workerSource).not.toContain("'/js/install-prompt.js'");
    expect(workerSource).not.toContain("'/js/vendor/idb.min.js'");
  });
});
