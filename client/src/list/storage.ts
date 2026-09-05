import type { ShoppingListItem } from './types';

const DB_NAME = 'provista-offline';
const DB_VERSION = 1;
const SHOPPING_STORE = 'shoppingList';
const QUEUE_STORE = 'syncQueue';
export const SHOPPING_QUEUE_CHANGED_EVENT = 'provista:shopping-queue-changed';

const STORE_KEY_PATHS: Record<string, string> = {
  items: '_id',
  stores: '_id',
  priceEntries: '_id',
  inventory: '_id',
  shoppingList: '_id',
  mealPlan: '_id',
  spendCache: 'month',
  syncQueue: 'id',
  metadata: 'collection'
};

export interface ShoppingQueueItem {
  id: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  collection: string;
  payload: unknown;
  path: string;
  method: 'POST' | 'PUT' | 'DELETE';
  createdAt: string;
  attempts: number;
  status: 'pending' | 'failed';
  localId?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function notifyQueueChanged() {
  window.dispatchEvent(new CustomEvent(SHOPPING_QUEUE_CHANGED_EVENT));
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}

function openOfflineDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, keyPath] of Object.entries(STORE_KEY_PATHS)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open offline storage'));
  });
  return dbPromise;
}

export async function readCachedShoppingList(): Promise<ShoppingListItem[]> {
  const db = await openOfflineDb();
  const transaction = db.transaction(SHOPPING_STORE, 'readonly');
  return requestResult(transaction.objectStore(SHOPPING_STORE).getAll()) as Promise<ShoppingListItem[]>;
}

export async function replaceCachedShoppingList(items: ShoppingListItem[]): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction([SHOPPING_STORE, 'metadata'], 'readwrite');
  const store = transaction.objectStore(SHOPPING_STORE);
  store.clear();
  items.forEach(item => store.put(item));
  transaction.objectStore('metadata').put({
    collection: SHOPPING_STORE,
    lastSyncedAt: new Date().toISOString()
  });
  await transactionDone(transaction);
}

export async function cacheShoppingItem(item: ShoppingListItem): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(SHOPPING_STORE, 'readwrite');
  transaction.objectStore(SHOPPING_STORE).put(item);
  await transactionDone(transaction);
}

export async function deleteCachedShoppingItem(id: string): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(SHOPPING_STORE, 'readwrite');
  transaction.objectStore(SHOPPING_STORE).delete(id);
  await transactionDone(transaction);
}

export async function queueShoppingWrite(input: {
  operation: ShoppingQueueItem['operation'];
  payload: unknown;
  path: string;
  method: ShoppingQueueItem['method'];
  localId?: string;
}): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(QUEUE_STORE, 'readwrite');
  const item: ShoppingQueueItem = {
    id: crypto.randomUUID(),
    collection: SHOPPING_STORE,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    ...input
  };
  transaction.objectStore(QUEUE_STORE).put(item);
  await transactionDone(transaction);
  notifyQueueChanged();
}

async function queueItems(): Promise<ShoppingQueueItem[]> {
  const db = await openOfflineDb();
  const transaction = db.transaction(QUEUE_STORE, 'readonly');
  return requestResult(transaction.objectStore(QUEUE_STORE).getAll()) as Promise<ShoppingQueueItem[]>;
}

async function updateQueueItem(item: ShoppingQueueItem): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(QUEUE_STORE, 'readwrite');
  transaction.objectStore(QUEUE_STORE).put(item);
  await transactionDone(transaction);
  notifyQueueChanged();
}

async function removeQueueItem(id: string): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(QUEUE_STORE, 'readwrite');
  transaction.objectStore(QUEUE_STORE).delete(id);
  await transactionDone(transaction);
  notifyQueueChanged();
}

export async function listFailedShoppingWrites(): Promise<ShoppingQueueItem[]> {
  return (await queueItems())
    .filter(item => item.collection === SHOPPING_STORE && item.status === 'failed')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function remapLocalReferences(localId: string, serverId: string, queue: ShoppingQueueItem[]) {
  const oldPath = `/shopping-list/${localId}`;
  const newPath = `/shopping-list/${serverId}`;
  for (const queued of queue) {
    if (queued.path !== oldPath) continue;
    queued.path = newPath;
    await updateQueueItem(queued);
  }
}

function queueTargetId(item: ShoppingQueueItem) {
  const prefix = '/shopping-list/';
  return item.path.startsWith(prefix) ? decodeURIComponent(item.path.slice(prefix.length)) : '';
}

function applyQueuedOptimism(
  canonical: ShoppingListItem[],
  cachedBefore: ShoppingListItem[],
  queued: ShoppingQueueItem[]
) {
  let result = canonical.map(item => ({ ...item }));
  for (const item of queued.sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (item.operation === 'CREATE' && item.localId) {
      const cached = cachedBefore.find(entry => entry._id === item.localId);
      if (cached && !result.some(entry => entry._id === cached._id)) result.push(cached);
      continue;
    }
    const targetId = queueTargetId(item);
    if (!targetId) continue;
    if (item.operation === 'DELETE') {
      result = result.filter(entry => entry._id !== targetId);
      continue;
    }
    if (item.operation === 'UPDATE' && item.payload && typeof item.payload === 'object') {
      result = result.map(entry => entry._id === targetId
        ? { ...entry, ...(item.payload as Partial<ShoppingListItem>) }
        : entry);
    }
  }
  return result;
}

export async function retryFailedShoppingWrite(id: string): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) throw new Error('Reconnect before retrying this List change.');
  const item = (await queueItems()).find(entry => entry.id === id && entry.collection === SHOPPING_STORE);
  if (!item || item.status !== 'failed') return { synced: 0, failed: 0 };
  item.status = 'pending';
  item.attempts = 2;
  await updateQueueItem(item);
  return processShoppingQueue();
}

export async function discardFailedShoppingWrite(id: string): Promise<ShoppingListItem[]> {
  if (!navigator.onLine) throw new Error('Reconnect before discarding a failed List change.');

  const allQueued = await queueItems();
  const target = allQueued.find(item => item.id === id && item.collection === SHOPPING_STORE && item.status === 'failed');
  if (!target) return readCachedShoppingList();

  const response = await fetch('/api/shopping-list', {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error('Could not refresh the saved List. Nothing was discarded.');

  const canonical = await response.json() as ShoppingListItem[];
  const cachedBefore = await readCachedShoppingList();
  const remaining = allQueued.filter(item => item.id !== id && item.collection === SHOPPING_STORE);
  const reconciled = applyQueuedOptimism(canonical, cachedBefore, remaining);

  const db = await openOfflineDb();
  const transaction = db.transaction([QUEUE_STORE, SHOPPING_STORE, 'metadata'], 'readwrite');
  transaction.objectStore(QUEUE_STORE).delete(id);
  const shoppingStore = transaction.objectStore(SHOPPING_STORE);
  shoppingStore.clear();
  reconciled.forEach(item => shoppingStore.put(item));
  transaction.objectStore('metadata').put({ collection: SHOPPING_STORE, lastSyncedAt: new Date().toISOString() });
  await transactionDone(transaction);
  notifyQueueChanged();
  return reconciled;
}

export async function processShoppingQueue(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  const pending = (await queueItems())
    .filter(item => item.collection === SHOPPING_STORE && item.status === 'pending')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const response = await fetch(`/api${item.path}`, {
        method: item.method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(item.payload && item.method !== 'DELETE' ? { body: JSON.stringify(item.payload) } : {})
      });

      if (!response.ok) {
        item.attempts += 1;
        item.status = item.attempts >= 3 ? 'failed' : 'pending';
        await updateQueueItem(item);
        if (item.status === 'failed') failed += 1;
        continue;
      }

      const data = await response.json().catch(() => null) as ShoppingListItem | null;
      if (item.localId && data?._id) {
        const cachedLocal = (await readCachedShoppingList()).find(entry => entry._id === item.localId);
        await deleteCachedShoppingItem(item.localId);
        if (cachedLocal) {
          await cacheShoppingItem({ ...data, ...cachedLocal, _id: data._id, itemId: data.itemId ?? cachedLocal.itemId });
        } else {
          await cacheShoppingItem(data);
        }
        await remapLocalReferences(item.localId, data._id, pending);
      } else if (data?._id) {
        await cacheShoppingItem(data);
      }
      await removeQueueItem(item.id);
      synced += 1;
    } catch {
      item.attempts += 1;
      item.status = item.attempts >= 3 ? 'failed' : 'pending';
      await updateQueueItem(item);
      if (item.status === 'failed') failed += 1;
      break;
    }
  }

  return { synced, failed };
}
