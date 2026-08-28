const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

async function createListItem(page, name, quantity = 1, storeId = null) {
  const itemResponse = await page.request.post('/api/items', {
    data: { name, category: 'Other', unit: 'each' }
  });
  expect(itemResponse.ok()).toBeTruthy();
  const item = await itemResponse.json();
  const listResponse = await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity, ...(storeId ? { storeId } : {}) }
  });
  expect(listResponse.ok()).toBeTruthy();
  return { item, listItem: await listResponse.json() };
}

async function reloadList(page) {
  await page.click('[data-tab="home"]');
  const listLoaded = page.waitForResponse(response =>
    response.url().includes('/api/shopping-list') &&
    response.request().method() === 'GET' &&
    response.ok()
  );
  await page.click('[data-tab="list"]');
  await listLoaded;
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
    const dialog = page.getByRole('dialog', { name: 'Add with details' });
    await expect(dialog).toBeVisible();
    await page.fill('#list-item-input', name);
    const createOption = page.locator('#list-item-dropdown .autocomplete-create');
    await expect(createOption).toContainText(`Create "${name}"`);
    await createOption.click();

    await expect(page.locator('#list-new-item-fields')).toBeVisible();
    await page.fill('#list-new-category', 'Pantry');
    await page.fill('#list-new-unit', 'each');
    await page.fill('#list-qty', '2');
    await dialog.getByRole('button', { name: 'Add to list', exact: true }).click();

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
    await expect(page.locator('#cart-bar-label')).toContainText('19 bought');
    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      return (await response.json()).filter(item => item.checked).length;
    }, { timeout: 6000 }).toBe(19);
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

  test('keeps Finish shopping visible and destructive list actions secondary', async ({ page }) => {
    const { listItem } = await createListItem(page, `Sticky Done ${Date.now()}`);
    await reloadList(page);
    await expect(page.locator('#btn-clear-all')).toBeHidden();
    await page.locator('#list-page-more-menu > summary').click();
    await expect(page.locator('#btn-clear-all')).toBeVisible();
    await page.locator('#list-page-more-menu > summary').click();

    await page.locator(`.list-item[data-id="${listItem._id}"] .list-item-check-wrap`).click();
    await expect(page.locator('#btn-done-shopping')).toBeVisible();
    await expect(page.locator('#btn-done-shopping')).toHaveText('Finish shopping');
    await expect(page.locator('#btn-remove-checked')).toBeHidden();
    await page.locator('#cart-more-menu > summary').click();
    await expect(page.locator('#btn-remove-checked')).toBeVisible();
  });

  test('offers Use, Update price, and Later inline without interrupting check-off', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const storeResponse = await page.request.post('/api/stores', { data: { name: `Inline Price Store ${suffix}` } });
    const store = await storeResponse.json();
    await page.request.patch('/api/household/settings', { data: { usualStoreId: store._id } });
    const { item, listItem } = await createListItem(page, `Inline Price Item ${suffix}`);
    await page.request.post('/api/prices', {
      data: { itemId: item._id, storeId: store._id, regularPrice: 4.29, quantity: 1 }
    });
    await reloadList(page);

    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await card.locator('.list-item-check-wrap').click();
    const choices = card.locator('.purchase-price-choice');
    await expect(choices).toBeVisible();
    await expect(choices.getByRole('button', { name: 'Use $4.29' })).toBeVisible();
    await expect(choices.getByRole('button', { name: 'Update price' })).toBeVisible();
    await expect(choices.getByRole('button', { name: 'Later' })).toBeVisible();
    await choices.getByRole('button', { name: 'Update price' }).click();
    await expect(page.locator('#modal-title')).toHaveText('Update price');
    await page.fill('#inline-price-value', '4.99');
    await page.getByRole('button', { name: 'Use this price' }).click();
    await expect(card.locator('.purchase-price-choice-status')).toContainText('$4.99');

    await card.locator('.purchase-price-choice').getByRole('button', { name: 'Later' }).click();
    await expect(card.locator('.purchase-price-choice-status')).toContainText('reviewed later');
    await card.locator('.purchase-price-choice').getByRole('button', { name: 'Use $4.29' }).click();
    await expect(card.locator('.purchase-price-choice-status')).toContainText('$4.29');
  });

  test('finishes one active shopping stop and leaves other items for the next stop', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const firstStoreResponse = await page.request.post('/api/stores', { data: { name: `First Stop ${suffix}` } });
    const secondStoreResponse = await page.request.post('/api/stores', { data: { name: `Second Stop ${suffix}` } });
    const firstStore = await firstStoreResponse.json();
    const secondStore = await secondStoreResponse.json();
    await page.request.patch('/api/household/settings', { data: { usualStoreId: firstStore._id } });

    const first = await createListItem(page, `First Stop Item ${suffix}`, 1, firstStore._id);
    const second = await createListItem(page, `Second Stop Item ${suffix}`, 1, secondStore._id);
    await reloadList(page);

    await page.locator(`.list-item[data-id="${first.listItem._id}"] .list-item-check-wrap`).click();
    await expect(page.locator('#cart-bar-label')).toContainText(firstStore.name);
    await page.locator('#btn-done-shopping').click();
    await expect(page.locator('#parent-trip-store')).toHaveValue(firstStore._id);
    await page.locator('#parent-finish-shopping').click();
    await expect(page.locator('#modal-overlay')).toBeHidden({ timeout: 10000 });

    await expect(page.locator(`.list-item[data-id="${first.listItem._id}"]`)).toHaveCount(0);
    await expect(page.locator(`.list-item[data-id="${second.listItem._id}"]`)).toBeVisible();
    await page.locator(`.list-item[data-id="${second.listItem._id}"] .list-item-check-wrap`).click();
    await expect(page.locator('#cart-bar-label')).toContainText(secondStore.name);
  });

  test('finishes a 20-item one-store trip and leaves only missing prices for later review', async ({ page }) => {
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
    await expect(page.locator('.purchase-price-choice')).toHaveCount(20);
    await expect(page.locator('.price-choice-btn.selected', { hasText: 'Later' })).toHaveCount(3);
    await page.locator('#btn-done-shopping').click();

    await expect(page.locator('#modal-title')).toHaveText('Finish shopping');
    await expect(page.locator('#parent-trip-store')).toHaveValue(store._id);
    await expect(page.locator('#parent-trip-price-summary')).toContainText('3 prices will be reviewed later');
    await expect(page.locator('.finish-shopping-confirmed')).toContainText('17 recorded prices');
    await expect(page.locator('.finish-shopping-outcomes')).toContainText('Update Spending');

    await page.locator('#parent-finish-shopping').click();
    await expect(page.locator('#modal-overlay')).toBeHidden({ timeout: 20000 });

    const [listResponse, pantryResponse, spendResponse, deferredResponse] = await Promise.all([
      page.request.get('/api/shopping-list'),
      page.request.get('/api/inventory'),
      page.request.get(`/api/spend?month=${new Date().toISOString().slice(0, 7)}`),
      page.request.get('/api/shopping-trips/deferred-prices')
    ]);
    expect(await listResponse.json()).toHaveLength(0);
    const purchasedIds = new Set(items.map(item => item._id));
    expect((await pantryResponse.json()).filter(entry => purchasedIds.has(entry.itemId?._id))).toHaveLength(20);
    expect((await spendResponse.json()).total).toBeGreaterThan(0);
    const tripDeferred = (await deferredResponse.json()).filter(entry => purchasedIds.has(entry.itemId));
    expect(tripDeferred).toHaveLength(3);
    expect(tripDeferred.map(entry => entry.itemId).sort()).toEqual(items.slice(17).map(item => item._id).sort());
  });
});
