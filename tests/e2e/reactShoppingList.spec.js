const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createCatalogItem(page, name, category = 'Other') {
  const response = await page.request.post('/api/items', {
    data: { name, category, unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createListItem(page, name, quantity = 1, storeId = null) {
  const item = await createCatalogItem(page, name);
  const listResponse = await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity, storeId }
  });
  expect(listResponse.ok()).toBeTruthy();
  return { item, listItem: await listResponse.json() };
}

test.describe('React Shopping List migration', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    const clear = await page.request.delete('/api/shopping-list');
    expect(clear.ok()).toBeTruthy();
  });

  test('renders the List inside the React application shell', async ({ page }) => {
    const { listItem } = await createListItem(page, `React List ${Date.now()}`);
    await page.goto('/app/list');

    await expect(page.locator('#react-list-title')).toHaveText('Shopping list');
    await expect(page.locator(`.list-item[data-id="${listItem._id}"]`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('adds one clear catalog match immediately in React', async ({ page }) => {
    const item = await createCatalogItem(page, `React Rapid Single ${Date.now()}`);
    await page.goto('/app/list');

    const input = page.locator('#react-rapid-list-input');
    await input.fill(item.name);
    await page.getByRole('button', { name: 'Add to list', exact: true }).click();

    await expect(page.locator('#react-rapid-status')).toHaveAttribute('data-state', 'success');
    await expect(page.locator('#react-rapid-status')).toContainText('Added 1 item');
    await expect(page.locator('.react-list-item', { hasText: item.name })).toContainText('Buy 1');
    await expect(input).toHaveValue('');
  });

  test('reviews several matched groceries before adding and rolls quantity into an existing item', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const [milk, eggs, bananas] = await Promise.all([
      createCatalogItem(page, `React Rapid Milk ${suffix}`),
      createCatalogItem(page, `React Rapid Eggs ${suffix}`),
      createCatalogItem(page, `React Rapid Bananas ${suffix}`)
    ]);
    const existing = await page.request.post('/api/shopping-list', { data: { itemId: milk._id, quantity: 2 } });
    expect(existing.ok()).toBeTruthy();

    await page.goto('/app/list');
    await page.locator('#react-rapid-list-input').fill(`${milk.name} x3, ${eggs.name}, ${bananas.name} x2`);
    await page.getByRole('button', { name: 'Add to list', exact: true }).click();

    await expect(page.locator('.react-rapid-preview')).toBeVisible();
    await expect(page.locator('.react-rapid-preview li')).toHaveCount(3);
    await expect(page.locator('.react-rapid-preview', { hasText: milk.name })).toContainText('× 3');

    let response = await page.request.get('/api/shopping-list');
    expect((await response.json())).toHaveLength(1);

    await page.getByRole('button', { name: 'Add 3 items', exact: true }).click();
    await expect(page.locator('.react-rapid-preview')).toHaveCount(0);
    await expect(page.locator('.react-list-item', { hasText: milk.name })).toContainText('Buy 5');
    await expect(page.locator('.react-list-item', { hasText: eggs.name })).toContainText('Buy 1');
    await expect(page.locator('.react-list-item', { hasText: bananas.name })).toContainText('Buy 2');

    response = await page.request.get('/api/shopping-list');
    const list = await response.json();
    expect(list.filter(entry => [milk._id, eggs._id, bananas._id].includes(entry.itemId?._id))).toHaveLength(3);
  });

  test('resolves ambiguous and unknown groceries through React Add with details', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const [first] = await Promise.all([
      createCatalogItem(page, `React Ambiguous ${suffix} One`),
      createCatalogItem(page, `React Ambiguous ${suffix} Two`)
    ]);
    const ambiguous = `React Ambiguous ${suffix}`;
    const missing = `React Missing ${suffix}`;

    await page.goto('/app/list');
    await page.locator('#react-rapid-list-input').fill(`${ambiguous}, ${missing}`);
    await page.getByRole('button', { name: 'Add to list', exact: true }).click();

    await expect(page.locator('.react-rapid-preview')).toBeVisible();
    await expect(page.locator('.react-rapid-preview')).toContainText('Needs a choice');
    await expect(page.locator('.react-rapid-preview')).toContainText('Needs details');
    await page.getByRole('button', { name: 'Review 2 items', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Add with details' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input').first()).toHaveValue(ambiguous);
    const existingChoice = dialog.getByText(first.name, { exact: false });
    await expect(existingChoice).toBeVisible();
    await existingChoice.click();
    await dialog.getByRole('button', { name: 'Add selected product', exact: true }).click();

    await expect(dialog.locator('input').first()).toHaveValue(missing);
    await dialog.getByRole('button', { name: 'Create & add', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#react-rapid-status')).toContainText('All items added');
    await expect(page.locator('.react-list-item', { hasText: first.name })).toBeVisible();
    await expect(page.locator('.react-list-item', { hasText: missing })).toBeVisible();
  });

  test('edits a List store preference in React', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const storeResponse = await page.request.post('/api/stores', { data: { name: `React Preferred Store ${suffix}` } });
    expect(storeResponse.ok()).toBeTruthy();
    const store = await storeResponse.json();
    const { item, listItem } = await createListItem(page, `React Store Preference ${suffix}`);

    await page.goto('/app/list');
    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await card.getByRole('button', { name: `Open item details for ${item.name}` }).click();
    const details = page.getByRole('dialog', { name: item.name });
    await details.getByRole('button', { name: `Store preference for ${item.name}: Any store` }).click();
    const dialog = page.getByRole('dialog', { name: 'Store preference' });
    await expect(dialog).toBeVisible();
    await dialog.locator('select').selectOption(store._id);
    await dialog.getByRole('button', { name: 'Save preference' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(details.getByRole('button', { name: `Store preference for ${item.name}: ${store.name}` })).toBeVisible();
    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      const list = await response.json();
      const saved = list.find(entry => entry._id === listItem._id);
      return saved?.storeId?._id || saved?.storeId;
    }).toBe(store._id);
  });

  test('groups each store by familiar sections and remembers a typed custom section', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const storeResponse = await page.request.post('/api/stores', { data: { name: `React Section Store ${suffix}` } });
    expect(storeResponse.ok()).toBeTruthy();
    const store = await storeResponse.json();
    const produce = await createCatalogItem(page, `React Apples ${suffix}`, 'Produce');
    const dairy = await createCatalogItem(page, `React Milk ${suffix}`, 'Dairy');
    const pantry = await createCatalogItem(page, `React Rice ${suffix}`, 'Pantry');
    const listResponses = await Promise.all([produce, dairy, pantry].map(item =>
      page.request.post('/api/shopping-list', { data: { itemId: item._id, quantity: 1, storeId: store._id } })
    ));
    expect(listResponses.every(response => response.ok())).toBeTruthy();

    await page.goto('/app/list');
    const storeGroup = page.getByRole('region', { name: `Suggested stop ${store.name}` });
    await expect(storeGroup.locator('.react-list-section-group[data-section="Produce"]')).toContainText(produce.name);
    await expect(storeGroup.locator('.react-list-section-group[data-section="Dairy & Eggs"]')).toContainText(dairy.name);
    await expect(storeGroup.locator('.react-list-section-group[data-section="Pantry"]')).toContainText(pantry.name);

    const dairyCard = page.locator('.react-list-item', { hasText: dairy.name });
    await dairyCard.getByRole('button', { name: `Open item details for ${dairy.name}` }).click();
    const details = page.getByRole('dialog', { name: dairy.name });
    await details.getByRole('button', { name: `Edit store section for ${dairy.name}: Dairy & Eggs` }).click();
    const dialog = page.getByRole('dialog', { name: 'Store section' });
    const input = dialog.getByRole('combobox', { name: 'Section' });
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await input.fill('International Foods');
    await dialog.getByRole('button', { name: 'Save section' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(storeGroup.locator('.react-list-section-group[data-section="International Foods"]')).toContainText(dairy.name);
    await details.getByRole('button', { name: 'Close item details' }).click();
    await page.reload();
    const reloadedGroup = page.getByRole('region', { name: `Suggested stop ${store.name}` });
    await expect(reloadedGroup.locator('.react-list-section-group[data-section="International Foods"]')).toContainText(dairy.name);

    const sections = await page.request.get('/api/item-sections').then(response => response.json());
    expect(sections.suggestions).toContain('International Foods');
  });

  test('shows optimistic check-off feedback before a slow write finishes', async ({ page }) => {
    const { listItem } = await createListItem(page, `React Latency ${Date.now()}`);
    await page.goto('/app/list');
    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await expect(card).toBeVisible();
    await page.route(`**/api/shopping-list/${listItem._id}`, async route => {
      if (route.request().method() === 'PUT') await new Promise(resolve => setTimeout(resolve, 1100));
      await route.continue();
    });

    const feedback = await page.evaluate(id => {
      const button = document.querySelector(`.list-item[data-id="${id}"] .list-item-check-wrap`);
      if (!button) throw new Error(`List item ${id} was not rendered before the latency assertion`);
      const start = performance.now();
      button.click();
      return new Promise(resolve => requestAnimationFrame(() => {
        const renderedCard = document.querySelector(`.list-item[data-id="${id}"]`);
        resolve({ elapsed: performance.now() - start, checked: renderedCard?.classList.contains('checked') === true });
      }));
    }, listItem._id);

    expect(feedback.checked).toBe(true);
    expect(feedback.elapsed).toBeLessThan(150);
    await expect(page.locator('#btn-done-shopping')).toBeVisible();
    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      return (await response.json()).find(item => item._id === listItem._id)?.checked;
    }, { timeout: 5000 }).toBe(true);
  });

  test('queues a supported List check-off offline and syncs it after reconnecting', async ({ page, context }) => {
    const { listItem } = await createListItem(page, `React Offline Check ${Date.now()}`);
    await page.goto('/app/list');
    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await expect(card).toBeVisible();

    await context.setOffline(true);
    await expect(page.locator('.react-list-offline')).toBeVisible();
    await card.locator('.list-item-check-wrap').click();
    await expect(card).toHaveClass(/checked/);
    await expect(page.locator('.shell-toast-region')).toContainText('Saved offline');

    await context.setOffline(false);
    await expect(page.locator('.react-list-offline')).toHaveCount(0);
    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      return (await response.json()).find(item => item._id === listItem._id)?.checked;
    }, { timeout: 10000 }).toBe(true);
  });

  test('rolls an optimistic check-off back when persistence fails', async ({ page }) => {
    const { listItem } = await createListItem(page, `React Rollback ${Date.now()}`);
    await page.goto('/app/list');
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
    await expect(page.locator('.shell-toast-region')).toContainText('rolled back');
  });

  test('keeps recent prices in item details and edits purchase price entirely in React', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const storeResponse = await page.request.post('/api/stores', { data: { name: `React Inline Price Store ${suffix}` } });
    expect(storeResponse.ok()).toBeTruthy();
    const store = await storeResponse.json();
    await page.request.patch('/api/household/settings', { data: { usualStoreId: store._id } });
    const { item, listItem } = await createListItem(page, `React Inline Price Item ${suffix}`);
    await page.request.post('/api/prices', {
      data: { itemId: item._id, storeId: store._id, regularPrice: 4.29, quantity: 1 }
    });

    await page.goto('/app/list');
    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await card.locator('.list-item-check-wrap').click();
    await card.getByRole('button', { name: `Open item details for ${item.name}` }).click();
    const details = page.getByRole('dialog', { name: item.name });
    const choices = details.locator('.purchase-price-choice');
    await expect(choices.locator('.purchase-price-choice-status')).toHaveText('Bought · using recent $4.29');
    await choices.getByRole('button', { name: 'Change' }).click();
    await expect(choices.getByRole('button', { name: 'Use recent $4.29' })).toBeVisible();
    await expect(choices.getByRole('button', { name: 'Update price' })).toBeVisible();
    await expect(choices.getByRole('button', { name: 'Later' })).toBeVisible();

    await choices.getByRole('button', { name: 'Update price' }).click();
    const priceDialog = page.getByRole('dialog', { name: 'Update price' });
    await expect(priceDialog).toBeVisible();
    await page.fill('#inline-price-value', '4.99');
    await priceDialog.getByRole('button', { name: 'Use this price' }).click();
    await expect(details.locator('.purchase-price-choice-status')).toHaveText('Bought · $4.99 recorded');

    await details.getByRole('button', { name: 'Change' }).click();
    await details.getByRole('button', { name: 'Later' }).click();
    await expect(details.locator('.purchase-price-choice-status')).toHaveText('Bought · price later');
    await details.getByRole('button', { name: 'Add price' }).click();
    await page.fill('#inline-price-value', '4.29');
    await page.getByRole('dialog', { name: 'Update price' }).getByRole('button', { name: 'Use this price' }).click();
    await expect(details.locator('.purchase-price-choice-status')).toHaveText('Bought · $4.29 recorded');
  });

  test('finishes one active React shopping stop and leaves another store for later', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const firstStoreResponse = await page.request.post('/api/stores', { data: { name: `React First Stop ${suffix}` } });
    const secondStoreResponse = await page.request.post('/api/stores', { data: { name: `React Second Stop ${suffix}` } });
    const firstStore = await firstStoreResponse.json();
    const secondStore = await secondStoreResponse.json();
    await page.request.patch('/api/household/settings', { data: { usualStoreId: firstStore._id } });

    const first = await createListItem(page, `React First Stop Item ${suffix}`, 1, firstStore._id);
    const second = await createListItem(page, `React Second Stop Item ${suffix}`, 1, secondStore._id);
    await page.goto('/app/list');

    await page.locator(`.list-item[data-id="${first.listItem._id}"] .list-item-check-wrap`).click();
    await expect(page.locator('#cart-bar-label')).toContainText(firstStore.name);
    await page.locator('#btn-done-shopping').click();
    const dialog = page.getByRole('dialog', { name: 'Finish shopping' });
    await expect(dialog.locator('#parent-trip-store')).toHaveValue(firstStore._id);
    await dialog.locator('#parent-finish-shopping').click();
    await expect(dialog).toHaveCount(0, { timeout: 10000 });

    await expect(page.locator(`.list-item[data-id="${first.listItem._id}"]`)).toHaveCount(0);
    await expect(page.locator(`.list-item[data-id="${second.listItem._id}"]`)).toBeVisible();
    await page.locator(`.list-item[data-id="${second.listItem._id}"] .list-item-check-wrap`).click();
    await expect(page.locator('#cart-bar-label')).toContainText(secondStore.name);
  });

  test('finishes a 20-item React trip and leaves only missing prices for later review', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const storeResponse = await page.request.post('/api/stores', { data: { name: `React One Store ${suffix}` } });
    expect(storeResponse.ok()).toBeTruthy();
    const store = await storeResponse.json();
    const settingsResponse = await page.request.patch('/api/household/settings', {
      data: { usualStoreId: store._id, priceFreshnessDays: 30, additionalStopSavingsThreshold: 10 }
    });
    expect(settingsResponse.ok()).toBeTruthy();

    const itemResponses = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      page.request.post('/api/items', {
        data: { name: `React Trip Item ${suffix} ${index + 1}`, category: 'Other', unit: 'each' }
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

    await page.goto('/app/list');
    await expect(page.locator('.react-list-item')).toHaveCount(20);
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
    await expect(page.locator('.react-list-item .purchase-price-choice')).toHaveCount(0);

    await page.locator('#btn-done-shopping').click();
    const dialog = page.getByRole('dialog', { name: 'Finish shopping' });
    await expect(dialog.locator('#parent-trip-store')).toHaveValue(store._id);
    await expect(dialog.locator('#parent-trip-price-summary')).toContainText('3 prices will be reviewed later');
    await expect(dialog.locator('.finish-shopping-confirmed')).toContainText('17 recorded prices');
    await expect(dialog.locator('.finish-shopping-outcomes')).toContainText('Update Spending');
    await expect(dialog.locator('.finish-shopping-outcomes')).toContainText('Update Pantry');

    await dialog.locator('#parent-finish-shopping').click();
    await expect(dialog).toHaveCount(0, { timeout: 20000 });

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