import type { ShoppingListItem } from './types';

const DB_NAME = 'provista-offline';
const DB_VERSION = 1;
const SHOPPING_STORE = 'shoppingList';
const QUEUE_STORE = 'syncQueue';

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

interface QueueItem {
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
  operation: QueueItem['operation'];
  payload: unknown;
  path: string;
  method: QueueItem['method'];
  localId?: string;
}): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(QUEUE_STORE, 'readwrite');
  const item: QueueItem = {
    id: crypto.randomUUID(),
    collection: SHOPPING_STORE,
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    ...input
  };
  transaction.objectStore(QUEUE_STORE).put(item);
  await transactionDone(transaction);
}

async function queueItems(): Promise<QueueItem[]> {
  const db = await openOfflineDb();
  const transaction = db.transaction(QUEUE_STORE, 'readonly');
  return requestResult(transaction.objectStore(QUEUE_STORE).getAll()) as Promise<QueueItem[]>;
}

async function updateQueueItem(item: QueueItem): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(QUEUE_STORE, 'readwrite');
  transaction.objectStore(QUEUE_STORE).put(item);
  await transactionDone(transaction);
}

async function removeQueueItem(id: string): Promise<void> {
  const db = await openOfflineDb();
  const transaction = db.transaction(QUEUE_STORE, 'readwrite');
  transaction.objectStore(QUEUE_STORE).delete(id);
  await transactionDone(transaction);
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
      if (item.localId) await deleteCachedShoppingItem(item.localId);
      if (data?._id) await cacheShoppingItem(data);
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
