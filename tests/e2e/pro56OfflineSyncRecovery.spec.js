const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createCatalogItem(page, name) {
  const response = await page.request.post('/api/items', {
    data: { name, category: 'Pantry', unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createListItem(page, name) {
  const item = await createCatalogItem(page, name);
  const response = await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity: 1 }
  });
  expect(response.ok()).toBeTruthy();
  return { item, listItem: await response.json() };
}

async function seedOfflineDb(page, { cachedItems = [], queue = [] }) {
  await page.evaluate(({ cachedItems, queue }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('provista-offline', 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      const stores = {
        items: '_id', stores: '_id', priceEntries: '_id', inventory: '_id', shoppingList: '_id',
        mealPlan: '_id', spendCache: 'month', syncQueue: 'id', metadata: 'collection'
      };
      for (const [name, keyPath] of Object.entries(stores)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(['shoppingList', 'syncQueue'], 'readwrite');
      const shopping = transaction.objectStore('shoppingList');
      const syncQueue = transaction.objectStore('syncQueue');
      shopping.clear();
      syncQueue.clear();
      cachedItems.forEach(item => shopping.put(item));
      queue.forEach(item => syncQueue.put(item));
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  }), { cachedItems, queue });
}

async function readQueue(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('provista-offline', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = db.transaction('syncQueue', 'readonly').objectStore('syncQueue').getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
    };
  }));
}

function failedUpdate(id, listItemId) {
  return {
    id,
    operation: 'UPDATE',
    collection: 'shoppingList',
    payload: { checked: true, shoppingStoreId: null },
    path: `/shopping-list/${listItemId}`,
    method: 'PUT',
    createdAt: new Date().toISOString(),
    attempts: 3,
    status: 'failed'
  };
}

test.describe('PRO-56 failed List sync recovery', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    const clear = await page.request.delete('/api/shopping-list');
    expect(clear.ok()).toBeTruthy();
  });

  test('keeps a failed write visible after another failed retry, then syncs it successfully', async ({ page }) => {
    const { item, listItem } = await createListItem(page, `PRO-56 Retry ${Date.now()}`);
    await page.goto('/app/list');
    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await expect(card).toBeVisible();

    const queueId = `failed-retry-${Date.now()}`;
    await seedOfflineDb(page, {
      cachedItems: [{ ...listItem, checked: true, actualPurchasedQuantity: 1 }],
      queue: [failedUpdate(queueId, listItem._id)]
    });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('provista:shopping-queue-changed')));

    const recovery = page.locator('.list-sync-recovery');
    await expect(recovery).toContainText('1 List change need attention');
    await recovery.getByRole('button', { name: 'Review' }).click();

    await page.route(`**/api/shopping-list/${listItem._id}`, async route => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Still unavailable' }) });
      } else {
        await route.continue();
      }
    });

    await recovery.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('.shell-toast-region')).toContainText('still could not sync');
    await expect(recovery).toContainText('1 List change need attention');
    await expect(recovery.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect.poll(async () => (await readQueue(page))[0]?.status).toBe('failed');

    await page.unroute(`**/api/shopping-list/${listItem._id}`);
    await recovery.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('.shell-toast-region')).toContainText('List change synced');
    await expect(recovery).toHaveCount(0);
    await expect.poll(async () => (await readQueue(page)).length).toBe(0);
    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      const list = await response.json();
      return list.find(entry => entry._id === listItem._id)?.checked;
    }).toBe(true);
    await expect(card).toHaveClass(/checked/);
    await expect(page.locator('#tab-list')).toHaveCount(0);
    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
  });

  test('discards only after restoring the canonical server List', async ({ page }) => {
    const { item, listItem } = await createListItem(page, `PRO-56 Discard ${Date.now()}`);
    await page.goto('/app/list');
    await expect(page.locator(`.list-item[data-id="${listItem._id}"]`)).toBeVisible();

    const queueId = `failed-discard-${Date.now()}`;
    await seedOfflineDb(page, {
      cachedItems: [{ ...listItem, checked: true, actualPurchasedQuantity: 1 }],
      queue: [failedUpdate(queueId, listItem._id)]
    });

    const listGetPattern = '**/api/shopping-list';
    await page.route(listGetPattern, async route => {
      if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/shopping-list') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Use device cache' }) });
      } else {
        await route.continue();
      }
    });
    await page.reload();

    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await expect(card).toHaveClass(/checked/);
    const recovery = page.locator('.list-sync-recovery');
    await expect(recovery).toBeVisible();
    await recovery.getByRole('button', { name: 'Review' }).click();
    await page.unroute(listGetPattern);

    await recovery.getByRole('button', { name: 'Discard' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Discard this unsynced List change?' });
    await expect(dialog).toContainText('reload the saved household List first');
    await dialog.getByRole('button', { name: 'Discard change' }).click();

    await expect(page.locator('.shell-toast-region')).toContainText('Saved household List restored');
    await expect(recovery).toHaveCount(0);
    await expect(card).not.toHaveClass(/checked/);
    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
    await expect.poll(async () => (await readQueue(page)).length).toBe(0);
  });

  test('discarding a failed offline create also removes dependent writes to its local id', async ({ page }) => {
    const item = await createCatalogItem(page, `PRO-56 Discard Local ${Date.now()}`);
    await page.goto('/app/list');

    const localId = `local-discard-${Date.now()}`;
    const now = Date.now();
    await seedOfflineDb(page, {
      cachedItems: [{
        _id: localId,
        itemId: item,
        storeId: null,
        shoppingStoreId: null,
        quantity: 1,
        intendedPurchaseQuantity: 1,
        requiredQuantity: null,
        actualPurchasedQuantity: 1,
        remainingRequiredQuantity: 0,
        quantitySource: 'user',
        checked: true,
        addedAt: new Date(now).toISOString()
      }],
      queue: [
        {
          id: `failed-create-${now}`,
          operation: 'CREATE',
          collection: 'shoppingList',
          payload: { itemId: item._id, quantity: 1 },
          path: '/shopping-list',
          method: 'POST',
          createdAt: new Date(now).toISOString(),
          attempts: 3,
          status: 'failed',
          localId
        },
        {
          id: `dependent-update-${now}`,
          operation: 'UPDATE',
          collection: 'shoppingList',
          payload: { checked: true, shoppingStoreId: null },
          path: `/shopping-list/${localId}`,
          method: 'PUT',
          createdAt: new Date(now + 1).toISOString(),
          attempts: 0,
          status: 'pending'
        }
      ]
    });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('provista:shopping-queue-changed')));

    const recovery = page.locator('.list-sync-recovery');
    await expect(recovery).toBeVisible();
    await recovery.getByRole('button', { name: 'Review' }).click();
    await recovery.getByRole('button', { name: 'Discard' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Discard this unsynced List change?' });
    await dialog.getByRole('button', { name: 'Discard change' }).click();

    await expect(recovery).toHaveCount(0);
    await expect.poll(async () => (await readQueue(page)).length).toBe(0);
    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      return (await response.json()).length;
    }).toBe(0);
    await expect(page.getByText('Your list is empty')).toBeVisible();
  });

  test('remaps follow-up writes from an offline-created local id to the real server id', async ({ page, context }) => {
    const item = await createCatalogItem(page, `PRO-56 Local Remap ${Date.now()}`);
    await page.goto('/app/list');

    await context.setOffline(true);
    await expect(page.locator('.react-list-offline')).toBeVisible();

    const localId = `local-pro56-${Date.now()}`;
    const now = Date.now();
    await seedOfflineDb(page, {
      cachedItems: [{
        _id: localId,
        itemId: item,
        storeId: null,
        shoppingStoreId: null,
        quantity: 1,
        intendedPurchaseQuantity: 1,
        requiredQuantity: null,
        actualPurchasedQuantity: 1,
        remainingRequiredQuantity: 0,
        quantitySource: 'user',
        checked: true,
        addedAt: new Date(now).toISOString()
      }],
      queue: [
        {
          id: `create-${now}`,
          operation: 'CREATE',
          collection: 'shoppingList',
          payload: { itemId: item._id, quantity: 1 },
          path: '/shopping-list',
          method: 'POST',
          createdAt: new Date(now).toISOString(),
          attempts: 0,
          status: 'pending',
          localId
        },
        {
          id: `update-${now}`,
          operation: 'UPDATE',
          collection: 'shoppingList',
          payload: { checked: true, shoppingStoreId: null },
          path: `/shopping-list/${localId}`,
          method: 'PUT',
          createdAt: new Date(now + 1).toISOString(),
          attempts: 0,
          status: 'pending'
        }
      ]
    });

    await context.setOffline(false);
    await expect(page.locator('.react-list-offline')).toHaveCount(0);

    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      const list = await response.json();
      const saved = list.find(entry => (entry.itemId?._id || entry.itemId) === item._id);
      return saved ? { count: list.length, checked: saved.checked, id: saved._id } : null;
    }, { timeout: 10000 }).toMatchObject({ count: 1, checked: true });
    await expect.poll(async () => (await readQueue(page)).length).toBe(0);
    await expect(page.locator('.list-sync-recovery')).toHaveCount(0);
  });
});
