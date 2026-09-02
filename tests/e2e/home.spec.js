const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createDeferredPrice(page) {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const storeResponse = await page.request.post('/api/stores', { data: { name: `Deferred Home Store ${suffix}` } });
  const itemResponse = await page.request.post('/api/items', {
    data: { name: `Deferred Home Item ${suffix}`, category: 'Other', unit: 'each' }
  });
  expect(storeResponse.ok()).toBeTruthy();
  expect(itemResponse.ok()).toBeTruthy();
  const store = await storeResponse.json();
  const item = await itemResponse.json();
  const listResponse = await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity: 1, storeId: store._id }
  });
  expect(listResponse.ok()).toBeTruthy();
  const listItem = await listResponse.json();
  const checked = await page.request.put(`/api/shopping-list/${listItem._id}`, { data: { checked: true } });
  expect(checked.ok()).toBeTruthy();
  const completed = await page.request.post('/api/shopping-list/complete', {
    data: {
      idempotencyKey: `home-deferred-${suffix}`,
      purchases: [{ listItemId: listItem._id, price: null, storeId: store._id }],
      addToPantry: false
    }
  });
  expect(completed.ok()).toBeTruthy();
  return { item, store, listItem };
}

async function resolveDeferredPrice(page, itemName) {
  const response = await page.request.get('/api/shopping-trips/deferred-prices');
  if (!response.ok()) return;
  const deferred = (await response.json()).find(item => item.itemName === itemName);
  if (!deferred) return;
  await page.request.patch(`/api/shopping-trips/${deferred.tripId}/items/${deferred.shoppingListItemId}/price`, {
    data: { price: 1, storeId: deferred.storeId }
  });
}

test.describe('Home / Today - React production slice', () => {
  test('opens on React Home with the four household questions', async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);

    await expect(page).toHaveURL('/');
    await expect(page.locator('#home-react-title')).toBeVisible();
    const questions = page.locator('.home-question');
    await expect(questions).toHaveCount(4);
    await expect(questions).toHaveText([
      'What’s for dinner?',
      'What do we need?',
      'Is anything running low?',
      'What should I do next?'
    ]);
  });

  test('uses five parent-centered bottom navigation destinations', async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);

    const nav = page.locator('.shell-bottom-nav button');
    await expect(nav).toHaveCount(5);
    await expect(nav.locator('small')).toHaveText(['Home', 'Plan', 'List', 'Pantry', 'More']);
    await expect(page.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  test('standalone Quick add opens the React List capture', async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);

    await page.getByRole('button', { name: 'Quick add' }).first().click();
    await expect(page).toHaveURL(/\/app\/list/);
    await expect(page.locator('#react-list-title')).toHaveText('Shopping list');
    await expect(page.locator('#react-rapid-list-input')).toBeVisible();
    await expect(page.locator('#modal-overlay')).toHaveCount(0);
  });

  test('empty What do we need Quick add has the same React capture outcome', async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);

    const card = page.locator('.home-react-card', { hasText: 'What do we need?' });
    await expect(card.getByRole('button', { name: 'Quick add →' })).toBeVisible({ timeout: 15000 });
    await card.getByRole('button', { name: 'Quick add →' }).click();
    await expect(page).toHaveURL(/\/app\/list/);
    await expect(page.locator('#react-rapid-list-input')).toBeVisible();
  });

  test('deferred prices become the next action and can be reviewed in React', async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    const { item } = await createDeferredPrice(page);

    try {
      await page.reload();
      const next = page.locator('.home-react-next');
      await expect(next).toContainText('Finish 1 shopping price');
      await expect(next).toContainText('You chose to review these later.');
      await expect(next).not.toContainText('You’re caught up');
      await next.getByRole('button', { name: 'Review prices →' }).click();

      const dialog = page.getByRole('dialog', { name: 'Review prices' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Done for now' })).toBeFocused();
      await dialog.getByRole('button', { name: 'Done for now' }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await resolveDeferredPrice(page, item.name);
    }
  });

  test('keeps the other Home cards useful when one endpoint fails', async ({ page, baseURL }) => {
    await page.route('**/api/inventory/low-stock', route => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporarily unavailable' })
    }));

    await loginAsReactHomeUser(page, baseURL);

    const failedLowStock = page.locator('.home-react-card', { hasText: 'Is anything running low?' });
    await expect(failedLowStock).toContainText('Couldn’t load this update');
    await expect(page.locator('.home-react-card', { hasText: 'What’s for dinner?' })).not.toContainText('Couldn’t load');
    await expect(page.locator('.home-react-card', { hasText: 'What do we need?' })).not.toContainText('Couldn’t load');
  });

  test('Plan dinner opens today in React Plan and focuses dinner', async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);

    await page.getByRole('button', { name: 'Plan dinner' }).first().click();
    await expect(page).toHaveURL(/\/app\/plan\?focus=today-dinner$/);
    await expect(page.locator('#plan-title')).toHaveText('Plan');
    await expect(page.locator('.plan-day-today input[data-meal-name="dinner-0"]')).toBeFocused({ timeout: 5000 });
  });

  test('remaining legacy More tools return Home to the React production surface', async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);

    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page).toHaveURL('/app/more');
    await expect(page.locator('#more-title')).toBeVisible();

    await page.getByRole('link', { name: /My Account/ }).click();
    await expect(page).toHaveURL('/app?tab=more&section=account');
    await expect(page.locator('#section-account')).toBeVisible();
    await page.locator('.nav-item[data-tab="home"]').click();

    await expect(page).toHaveURL('/app');
    await expect(page.locator('#home-react-title')).toBeVisible();
  });
});
