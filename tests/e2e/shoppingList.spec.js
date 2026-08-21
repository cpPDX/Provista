const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

async function createListItem(page, name, quantity = 1) {
  const itemResponse = await page.request.post('/api/items', {
    data: { name, category: 'Other', unit: 'each' }
  });
  expect(itemResponse.ok()).toBeTruthy();
  const item = await itemResponse.json();
  const listResponse = await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity }
  });
  expect(listResponse.ok()).toBeTruthy();
  return { item, listItem: await listResponse.json() };
}

async function reloadList(page) {
  await page.click('[data-tab="home"]');
  await page.click('[data-tab="list"]');
  await page.waitForSelector('.list-item, .empty-state');
}

test.describe('Shopping List critical flows', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    const clearResponse = await page.request.delete('/api/shopping-list');
    expect(clearResponse.ok()).toBeTruthy();
    await page.click('[data-tab="list"]');
  });

  test('creates a completely new catalog item without closing the List form', async ({ page }) => {
    const name = `Inline List Item ${Date.now()}`;
    await page.click('#btn-add-list-item');
    await page.fill('#list-item-input', name);
    const createOption = page.locator('#list-item-dropdown .autocomplete-create');
    await expect(createOption).toContainText(`Create "${name}"`);
    await createOption.click();

    await expect(page.locator('#list-new-item-fields')).toBeVisible();
    await page.fill('#list-new-category', 'Pantry');
    await page.fill('#list-new-unit', 'each');
    await page.fill('#list-qty', '2');
    await page.getByRole('button', { name: 'Add to List' }).click();

    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('.list-item', { hasText: name })).toContainText('qty 2');
  });

  test('shows check-off feedback under 150 ms during 1.1 second store latency', async ({ page }) => {
    const { listItem } = await createListItem(page, `Latency Item ${Date.now()}`);
    await reloadList(page);
    await page.route(`**/api/shopping-list/${listItem._id}`, async route => {
      if (route.request().method() === 'PUT') await new Promise(resolve => setTimeout(resolve, 1100));
      await route.continue();
    });

    const feedback = await page.evaluate(id => {
      const button = document.querySelector(`.list-item[data-id="${id}"] .list-item-check-wrap`);
      const start = performance.now();
      button.click();
      return new Promise(resolve => requestAnimationFrame(() => {
        const card = document.querySelector(`.list-item[data-id="${id}"]`);
        resolve({ elapsed: performance.now() - start, checked: card.classList.contains('checked') });
      }));
    }, listItem._id);

    expect(feedback.checked).toBe(true);
    expect(feedback.elapsed).toBeLessThan(150);
    await expect(page.locator('#btn-done-shopping')).toBeVisible();
    await page.click('[data-tab="home"]');
    await page.click('[data-tab="list"]');
    await expect(page.locator(`.list-item[data-id="${listItem._id}"]`)).toHaveClass(/checked/);
    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      return (await response.json()).find(item => item._id === listItem._id)?.checked;
    }, { timeout: 5000 }).toBe(true);
  });

  test('checks 20 items quickly and preserves an undo during throttled writes', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const created = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      createListItem(page, `Rapid ${suffix} ${index + 1}`)
    ));
    const ids = created.map(entry => entry.listItem._id);
    await reloadList(page);
    await page.route('**/api/shopping-list/*', async route => {
      if (route.request().method() === 'PUT') await new Promise(resolve => setTimeout(resolve, 900));
      await route.continue();
    });

    const elapsed = await page.evaluate(itemIds => {
      const started = performance.now();
      itemIds.forEach(id => document.querySelector(`.list-item[data-id="${id}"] .list-item-check-wrap`)?.click());
      document.querySelector(`.list-item[data-id="${itemIds[0]}"] .list-item-check-wrap`)?.click();
      return performance.now() - started;
    }, ids);

    expect(elapsed).toBeLessThan(1000);
    await expect(page.locator(`.list-item[data-id="${ids[0]}"]`)).not.toHaveClass(/checked/);
    await expect(page.locator('.list-item.checked')).toHaveCount(19);
    await expect(page.locator('#cart-bar-label')).toContainText('(19 items)');
    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      return (await response.json()).filter(item => item.checked).length;
    }, { timeout: 6000 }).toBe(19);
    const response = await page.request.get('/api/shopping-list');
    const list = await response.json();
    expect(list.find(item => item._id === ids[0]).checked).toBe(false);
  });

  test('rolls an optimistic check-off back when persistence fails', async ({ page }) => {
    const { listItem } = await createListItem(page, `Rollback Item ${Date.now()}`);
    await reloadList(page);
    await page.route(`**/api/shopping-list/${listItem._id}`, async route => {
      if (route.request().method() === 'PUT') {
        await new Promise(resolve => setTimeout(resolve, 350));
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Store unavailable' }) });
      } else {
        await route.continue();
      }
    });

    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await card.locator('.list-item-check-wrap').click();
    await expect(card).toHaveClass(/checked/);
    await expect(card).not.toHaveClass(/checked/, { timeout: 3000 });
    await expect(page.locator('#toast')).toContainText('rolled back');
  });

  test('keeps Done shopping visible and puts removal without recording in a secondary menu', async ({ page }) => {
    const { listItem } = await createListItem(page, `Sticky Done ${Date.now()}`);
    await reloadList(page);
    await page.locator(`.list-item[data-id="${listItem._id}"] .list-item-check-wrap`).click();

    await expect(page.locator('#btn-done-shopping')).toBeVisible();
    await expect(page.getByText('Clear Checked', { exact: true })).toHaveCount(0);
    await expect(page.locator('#btn-remove-checked')).toBeHidden();
    await page.locator('#cart-more-menu > summary').click();
    await expect(page.locator('#btn-remove-checked')).toBeVisible();
  });

  test('finishes a 20-item one-store trip with only three price exceptions in under 20 seconds', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const storeResponse = await page.request.post('/api/stores', { data: { name: `One Store ${suffix}` } });
    expect(storeResponse.ok()).toBeTruthy();
    const store = await storeResponse.json();
    const settingsResponse = await page.request.patch('/api/household/settings', {
      data: { usualStoreId: store._id, priceFreshnessDays: 30, additionalStopSavingsThreshold: 10 }
    });
    expect(settingsResponse.ok()).toBeTruthy();

    const itemResponses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      page.request.post('/api/items', {
        data: { name: `Trip Item ${suffix} ${index + 1}`, category: 'Other', unit: 'each' }
      })
    ));
    expect(itemResponses.every(response => response.ok())).toBeTruthy();
    const items = await Promise.all(itemResponses.map(response => response.json()));
    const priceResponses = await Promise.all(items.slice(0, 17).map((item, index) =>
      page.request.post('/api/prices', {
        data: { itemId: item._id, storeId: store._id, regularPrice: 2 + index / 10, quantity: 1 }
      })
    ));
    expect(priceResponses.every(response => response.ok())).toBeTruthy();
    const listResponses = await Promise.all(items.map(item =>
      page.request.post('/api/shopping-list', { data: { itemId: item._id, quantity: 1 } })
    ));
    expect(listResponses.every(response => response.ok())).toBeTruthy();
    const listItems = await Promise.all(listResponses.map(response => response.json()));
    await reloadList(page);
    await page.route('**/api/shopping-list/**', async route => {
      const request = route.request();
      if (request.method() === 'PUT' || request.url().endsWith('/api/shopping-list/complete')) {
        await new Promise(resolve => setTimeout(resolve, 900));
      }
      await route.continue();
    });

    await page.evaluate(ids => {
      ids.forEach(id => document.querySelector(`.list-item[data-id="${id}"] .list-item-check-wrap`)?.click());
    }, listItems.map(item => item._id));
    await expect(page.locator('.list-item.checked')).toHaveCount(20);
    await expect(page.locator('#btn-done-shopping')).toBeVisible();
    await page.locator('#btn-done-shopping').click();

    await expect(page.locator('#modal-title')).toHaveText('Review shopping trip');
    await expect(page.locator('#trip-store-select')).toHaveValue(store._id);
    await expect(page.locator('#trip-price-exceptions .trip-review-item')).toHaveCount(3);
    await expect(page.locator('#trip-known-price-items .trip-review-item')).toHaveCount(17);
    await expect(page.locator('#trip-known-prices')).not.toHaveAttribute('open', '');
    await expect(page.locator('.trip-store-once select')).toHaveCount(1);

    const exceptionInputs = page.locator('#trip-price-exceptions .trip-price-input');
    for (let index = 0; index < 3; index++) await exceptionInputs.nth(index).fill(String(4 + index));
    const started = Date.now();
    await page.locator('#btn-finish-trip').click();
    await expect(page.locator('#modal-overlay')).toBeHidden({ timeout: 20000 });
    expect(Date.now() - started).toBeLessThan(20000);

    const [listResponse, pantryResponse, spendResponse] = await Promise.all([
      page.request.get('/api/shopping-list'),
      page.request.get('/api/inventory'),
      page.request.get(`/api/spend?month=${new Date().toISOString().slice(0, 7)}`)
    ]);
    expect(await listResponse.json()).toHaveLength(0);
    const purchasedIds = new Set(items.map(item => item._id));
    expect((await pantryResponse.json()).filter(entry => purchasedIds.has(entry.itemId?._id))).toHaveLength(20);
    expect((await spendResponse.json()).total).toBeGreaterThan(0);
  });
});
