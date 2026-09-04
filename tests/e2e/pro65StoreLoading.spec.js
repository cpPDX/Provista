const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createProduct(page, name) {
  const response = await page.request.post('/api/items', {
    data: { name, category: 'Pantry', unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createStore(page, name) {
  const response = await page.request.post('/api/stores', { data: { name } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function addListItem(page, itemId) {
  const response = await page.request.post('/api/shopping-list', {
    data: { itemId, quantity: 1 }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function openStorePreference(page, productName) {
  const card = page.locator('.react-list-item', { hasText: productName });
  await card.getByRole('button', { name: `Open item details for ${productName}` }).click();
  const details = page.getByRole('dialog', { name: productName, exact: true });
  await details.getByRole('button', { name: new RegExp(`Store preference for ${productName}`) }).click();
  return page.getByRole('dialog', { name: 'Store preference', exact: true });
}

test.describe('PRO-65 store loading hardening', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    const clear = await page.request.delete('/api/shopping-list');
    expect(clear.ok()).toBeTruthy();
  });

  test('prefetches stores on List load and Store Preference resolves a delayed request automatically', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const product = await createProduct(page, `PRO65 Prefetch Item ${suffix}`);
    const store = await createStore(page, `PRO65 Prefetch Store ${suffix}`);
    await addListItem(page, product._id);

    let releaseStores;
    const gate = new Promise(resolve => { releaseStores = resolve; });
    let storeRequests = 0;
    await page.route('**/api/stores', async route => {
      storeRequests += 1;
      await gate;
      await route.continue();
    });

    await page.goto('/app/list');
    await expect.poll(() => storeRequests).toBe(1);

    const preference = await openStorePreference(page, product.name);
    await expect(preference.getByText('Loading stores…', { exact: true })).toBeVisible();
    await expect(preference.getByLabel('Prefer to buy this at')).toBeDisabled();

    releaseStores();
    await expect(preference.getByText('Loading stores…', { exact: true })).toHaveCount(0);
    await expect(preference.getByLabel('Prefer to buy this at').getByRole('option', { name: store.name })).toHaveCount(1);
    await expect(preference.getByLabel('Prefer to buy this at')).toBeEnabled();

    await preference.getByRole('button', { name: 'Cancel' }).click();
    const details = page.getByRole('dialog', { name: product.name, exact: true });
    await details.getByRole('button', { name: 'Close item details' }).click();

    await page.getByRole('button', { name: `Mark as purchased ${product.name}` }).click();
    await page.getByRole('button', { name: 'Finish shopping', exact: true }).click();
    const checkout = page.getByRole('dialog', { name: 'Finish shopping', exact: true });
    await expect(checkout.getByText('Loading stores…', { exact: true })).toHaveCount(0);
    await expect(checkout.getByLabel('Where are you shopping now?').getByRole('option', { name: store.name })).toHaveCount(1);
    expect(storeRequests).toBe(1);
  });

  test('Finish Shopping shows a real loading state instead of an empty interactive selector', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const product = await createProduct(page, `PRO65 Checkout Item ${suffix}`);
    const store = await createStore(page, `PRO65 Checkout Store ${suffix}`);
    await addListItem(page, product._id);

    let releaseStores;
    const gate = new Promise(resolve => { releaseStores = resolve; });
    await page.route('**/api/stores', async route => {
      await gate;
      await route.continue();
    });

    await page.goto('/app/list');
    await page.getByRole('button', { name: `Mark as purchased ${product.name}` }).click();
    await page.getByRole('button', { name: 'Finish shopping', exact: true }).click();

    const checkout = page.getByRole('dialog', { name: 'Finish shopping', exact: true });
    const storeSelect = checkout.getByLabel('Where are you shopping now?');
    await expect(checkout.getByText('Loading stores…', { exact: true })).toBeVisible();
    await expect(storeSelect).toBeDisabled();
    await expect(checkout.getByRole('button', { name: 'Finish shopping', exact: true })).toBeDisabled();

    releaseStores();
    await expect(checkout.getByText('Loading stores…', { exact: true })).toHaveCount(0);
    await expect(storeSelect.getByRole('option', { name: store.name })).toHaveCount(1);
    await expect(storeSelect).toBeEnabled();
  });

  test('surfaces store failures with retry and recovers without reopening the dialog', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const product = await createProduct(page, `PRO65 Retry Item ${suffix}`);
    const store = await createStore(page, `PRO65 Retry Store ${suffix}`);
    await addListItem(page, product._id);

    let attempts = 0;
    await page.route('**/api/stores', async route => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'test store failure' }) });
        return;
      }
      await route.continue();
    });

    await page.goto('/app/list');
    const preference = await openStorePreference(page, product.name);
    await expect(preference.getByText('Couldn’t load stores.', { exact: true })).toBeVisible();
    await expect(preference.getByLabel('Prefer to buy this at')).toBeDisabled();

    await preference.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(preference.getByText('Couldn’t load stores.', { exact: true })).toHaveCount(0);
    await expect(preference.getByLabel('Prefer to buy this at').getByRole('option', { name: store.name })).toHaveCount(1);
    await expect(preference.getByLabel('Prefer to buy this at')).toBeEnabled();
    expect(attempts).toBe(2);
  });
});
