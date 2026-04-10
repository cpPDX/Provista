// Provista Offline Support
// IndexedDB layer, sync queue, online/offline detection, status indicator

const DB_NAME = 'provista-offline';
const DB_VERSION = 1;
const STALE_THRESHOLD = 15 * 60 * 1000; // 15 minutes

const STORES = ['items', 'stores', 'priceEntries', 'inventory', 'shoppingList', 'mealPlan', 'spendCache', 'syncQueue', 'metadata'];

// ============================================================
// IndexedDB Database
// ============================================================

const offlineDb = {
  _db: null,

  async open() {
    if (this._db) return this._db;
    this._db = await idb.openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            const keyPath = name === 'syncQueue' ? 'id'
              : name === 'metadata' ? 'collection'
              : name === 'spendCache' ? 'month'
              : '_id';
            db.createObjectStore(name, { keyPath });
          }
        }
      }
    });
    return this._db;
  },

  async getAll(storeName) {
    const db = await this.open();
    return db.getAll(storeName);
  },

  async get(storeName, key) {
    const db = await this.open();
    return db.get(storeName, key);
  },

  async put(storeName, data) {
    const db = await this.open();
    return db.put(storeName, data);
  },

  async putAll(storeName, items) {
    const db = await this.open();
    const tx = db.transaction(storeName, 'readwrite');
    for (const item of items) {
      tx.store.put(item);
    }
    await tx.done;
  },

  async delete(storeName, key) {
    const db = await this.open();
    return db.delete(storeName, key);
  },

  async clear(storeName) {
    const db = await this.open();
    return db.clear(storeName);
  },

  // Populate all stores from bootstrap data
  async populate(data) {
    const db = await this.open();
    const now = new Date().toISOString();

    const mapping = {
      items: data.items || [],
      stores: data.stores || [],
      priceEntries: data.priceEntries || [],
      inventory: data.inventory || [],
      shoppingList: data.shoppingList || [],
      mealPlan: data.mealPlan || [],
      spendCache: data.spendCache || []
    };

    for (const [storeName, items] of Object.entries(mapping)) {
      const tx = db.transaction(storeName, 'readwrite');
      await tx.store.clear();
      for (const item of items) {
        tx.store.put(item);
      }
      await tx.done;
    }

    // Update sync timestamps for all collections
    const metaTx = db.transaction('metadata', 'readwrite');
    for (const collection of Object.keys(mapping)) {
      metaTx.store.put({ collection, lastSyncedAt: now });
    }
    await metaTx.done;
  },

  // Update a single collection's cache from fresh API data
  async updateCollection(storeName, items) {
    const db = await this.open();
    const tx = db.transaction(storeName, 'readwrite');
    await tx.store.clear();
    for (const item of items) {
      tx.store.put(item);
    }
    await tx.done;
    await this.setLastSynced(storeName);
  },

  async getLastSynced(collection) {
    const meta = await this.get('metadata', collection);
    return meta?.lastSyncedAt || null;
  },

  async setLastSynced(collection) {
    await this.put('metadata', { collection, lastSyncedAt: new Date().toISOString() });
  },

  async isStale(collection) {
    const lastSynced = await this.getLastSynced(collection);
    if (!lastSynced) return true;
    return (Date.now() - new Date(lastSynced).getTime()) > STALE_THRESHOLD;
  },

  async hasData() {
    const meta = await this.getAll('metadata');
    return meta.length > 0;
  }
};

// ============================================================
// Sync Queue
// ============================================================

const syncQueue = {
  async add(operation, collection, payload, path, method) {
    const item = {
      id: crypto.randomUUID(),
      operation,
      collection,
      payload,
      path,
      method,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending'
    };
    await offlineDb.put('syncQueue', item);
    offlineManager.updateIndicator();
    return item;
  },

  async getAll() {
    return offlineDb.getAll('syncQueue');
  },

  async getPending() {
    const all = await this.getAll();
    return all.filter(i => i.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async getFailed() {
    const all = await this.getAll();
    return all.filter(i => i.status === 'failed');
  },

  async remove(id) {
    await offlineDb.delete('syncQueue', id);
  },

  async markFailed(id) {
    const item = await offlineDb.get('syncQueue', id);
    if (item) {
      item.attempts++;
      item.status = item.attempts >= 3 ? 'failed' : 'pending';
      await offlineDb.put('syncQueue', item);
    }
  },

  async retry(id) {
    const item = await offlineDb.get('syncQueue', id);
    if (item) {
      item.status = 'pending';
      item.attempts = 0;
      await offlineDb.put('syncQueue', item);
      this.process();
    }
  },

  async discard(id) {
    await this.remove(id);
    offlineManager.updateIndicator();
    const failed = await this.getFailed();
    if (failed.length === 0) {
      offlineManager.hideSyncFailure();
    }
  },

  async process() {
    if (!offlineManager.isOnline || syncQueue._processing) return;
    syncQueue._processing = true;

    const pending = await this.getPending();
    if (pending.length === 0) {
      syncQueue._processing = false;
      return;
    }

    offlineManager.setIndicator('syncing');
    let synced = 0;

    for (const item of pending) {
      try {
        const opts = { method: item.method, headers: { 'Content-Type': 'application/json' } };
        if (item.payload && item.method !== 'GET') {
          opts.body = JSON.stringify(item.payload);
        }
        const res = await fetch('/api' + item.path, opts);

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          // Update local IndexedDB with server response
          if (data._id && item.collection) {
            await offlineDb.put(item.collection, data);
          }
          await this.remove(item.id);
          synced++;
        } else {
          await this.markFailed(item.id);
        }
      } catch {
        // Network error during sync — stop processing
        await this.markFailed(item.id);
        break;
      }
    }

    syncQueue._processing = false;

    if (synced > 0) {
      offlineManager.setIndicator('synced', synced);
    }

    const failed = await this.getFailed();
    if (failed.length > 0) {
      offlineManager.showSyncFailure(failed.length);
    } else {
      offlineManager.hideSyncFailure();
    }
  },

  _processing: false
};

// ============================================================
// Online/Offline Manager
// ============================================================

const offlineManager = {
  isOnline: navigator.onLine,
  _listeners: [],
  _initialized: false,

  init() {
    if (this._initialized) return;
    this._initialized = true;

    window.addEventListener('online', () => this._handleOnline());
    window.addEventListener('offline', () => this._handleOffline());

    // Initial check with health ping
    if (navigator.onLine) {
      this._healthCheck();
    } else {
      this.isOnline = false;
      this.updateIndicator();
    }
  },

  onStatusChange(callback) {
    this._listeners.push(callback);
  },

  async _healthCheck() {
    try {
      const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
      this.isOnline = res.ok;
    } catch {
      this.isOnline = false;
    }
    this.updateIndicator();
  },

  _handleOnline() {
    // Verify with health check before declaring online
    this._healthCheck().then(() => {
      if (this.isOnline) {
        this._notify();
        syncQueue.process();
        offlineBootstrap.refreshStaleCollections();
      }
    });
  },

  _handleOffline() {
    this.isOnline = false;
    this.updateIndicator();
    this._notify();
  },

  _notify() {
    for (const cb of this._listeners) {
      try { cb(this.isOnline); } catch {}
    }
  },

  // Status indicator management
  updateIndicator() {
    const el = document.getElementById('offline-indicator');
    if (!el) return;

    if (this.isOnline) {
      el.style.display = 'none';
      el.className = 'offline-indicator';
    } else {
      el.style.display = '';
      el.className = 'offline-indicator offline';
      el.innerHTML = '<span class="offline-indicator-icon">⚡</span> Offline';
    }
  },

  setIndicator(state, count) {
    const el = document.getElementById('offline-indicator');
    if (!el) return;

    if (state === 'syncing') {
      el.style.display = '';
      el.className = 'offline-indicator syncing';
      el.innerHTML = '<span class="offline-indicator-spinner"></span> Syncing\u2026';
    } else if (state === 'synced') {
      el.style.display = '';
      el.className = 'offline-indicator synced';
      el.innerHTML = `Synced${count ? ' ' + count + ' change' + (count !== 1 ? 's' : '') : ''}`;
      setTimeout(() => {
        if (el.classList.contains('synced')) {
          el.style.display = 'none';
          el.className = 'offline-indicator';
        }
      }, 2000);
    }
  },

  showSyncFailure(count) {
    const el = document.getElementById('sync-failure-badge');
    if (!el) return;
    el.style.display = '';
    el.textContent = `${count} change${count !== 1 ? 's' : ''} couldn\u2019t sync`;
  },

  hideSyncFailure() {
    const el = document.getElementById('sync-failure-badge');
    if (el) el.style.display = 'none';
  }
};

// ============================================================
// Bootstrap & Cache Refresh
// ============================================================

const offlineBootstrap = {
  async init() {
    await offlineDb.open();
    const hasData = await offlineDb.hasData();

    if (offlineManager.isOnline) {
      if (!hasData) {
        // First load — fetch everything
        await this.fullBootstrap();
      } else {
        // Refresh stale collections in the background
        this.refreshStaleCollections();
      }
    }
    // If offline and no data, the UI will show an appropriate message
  },

  async fullBootstrap() {
    try {
      const res = await fetch('/api/sync/bootstrap');
      if (!res.ok) return;
      const data = await res.json();
      await offlineDb.populate(data);
    } catch {
      // Bootstrap failed — will retry next time
    }
  },

  async refreshStaleCollections() {
    // Collection name → API path for refreshing
    const refreshMap = {
      items: '/api/items',
      stores: '/api/stores',
      shoppingList: '/api/shopping-list',
      inventory: '/api/inventory'
    };

    for (const [collection, apiPath] of Object.entries(refreshMap)) {
      const stale = await offlineDb.isStale(collection);
      if (!stale) continue;

      try {
        const res = await fetch(apiPath);
        if (res.ok) {
          const data = await res.json();
          await offlineDb.updateCollection(collection, Array.isArray(data) ? data : [data]);
        }
      } catch {
        // Network error during refresh — skip
      }
    }
  }
};

// ============================================================
// API path → IndexedDB store mapping
// ============================================================

const PATH_STORE_MAP = {
  '/items': 'items',
  '/stores': 'stores',
  '/prices': 'priceEntries',
  '/inventory': 'inventory',
  '/shopping-list': 'shoppingList',
  '/meal-plan': 'mealPlan',
  '/spend': 'spendCache'
};

function resolveStore(apiPath) {
  // Match the base path (e.g., /items from /items/123)
  for (const [prefix, store] of Object.entries(PATH_STORE_MAP)) {
    if (apiPath === prefix || apiPath.startsWith(prefix + '/') || apiPath.startsWith(prefix + '?')) {
      return store;
    }
  }
  return null;
}

// ============================================================
// Offline Query Filtering
// ============================================================

// Client-side filtering for endpoints that return subsets of a collection.
// Returns filtered data, or null if no special filtering is needed.
async function offlineFilter(store, path) {
  // /prices/history/:itemId — all entries for one item, newest first
  const historyMatch = path.match(/^\/prices\/history\/([a-f0-9]+)$/);
  if (historyMatch) {
    const itemId = historyMatch[1];
    const all = await offlineDb.getAll('priceEntries');
    return all
      .filter(e => {
        const eid = e.itemId?._id || e.itemId;
        return String(eid) === itemId;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  // /prices/compare/:itemId — latest approved price per store, sorted by pricePerUnit
  const compareMatch = path.match(/^\/prices\/compare\/([a-f0-9]+)$/);
  if (compareMatch) {
    const itemId = compareMatch[1];
    const all = await offlineDb.getAll('priceEntries');
    const forItem = all.filter(e => {
      const eid = e.itemId?._id || e.itemId;
      return String(eid) === itemId && e.status === 'approved';
    });
    // Group by store, take most recent per store
    const byStore = {};
    for (const e of forItem) {
      const sid = String(e.storeId?._id || e.storeId);
      if (!byStore[sid] || new Date(e.date) > new Date(byStore[sid].date)) {
        byStore[sid] = e;
      }
    }
    return Object.values(byStore).sort((a, b) => a.pricePerUnit - b.pricePerUnit);
  }

  // /prices/last-purchased/:itemId — most recent approved entry per store
  const lastPurchasedMatch = path.match(/^\/prices\/last-purchased\/([a-f0-9]+)$/);
  if (lastPurchasedMatch) {
    const itemId = lastPurchasedMatch[1];
    const all = await offlineDb.getAll('priceEntries');
    const forItem = all.filter(e => {
      const eid = e.itemId?._id || e.itemId;
      return String(eid) === itemId && e.status === 'approved';
    });
    const byStore = {};
    for (const e of forItem) {
      const sid = String(e.storeId?._id || e.storeId);
      if (!byStore[sid] || new Date(e.date) > new Date(byStore[sid].date)) {
        byStore[sid] = e;
      }
    }
    return Object.values(byStore);
  }

  // /spend?month=YYYY-MM — cached spend data for a specific month
  const spendMatch = path.match(/^\/spend\?month=(\d{4}-\d{2})$/);
  if (spendMatch) {
    const month = spendMatch[1];
    const cached = await offlineDb.get('spendCache', month);
    // Return the shape the spend tab expects
    return cached || { month, total: 0, byCategory: [], byStore: [] };
  }

  // /spend/summary — all cached months
  if (path === '/spend/summary') {
    return offlineDb.getAll('spendCache');
  }

  // /inventory/low-stock — filter inventory to low stock items
  if (path === '/inventory/low-stock') {
    const all = await offlineDb.getAll('inventory');
    return all.filter(i =>
      i.lowStockThreshold != null && i.quantity <= i.lowStockThreshold
    );
  }

  // /prices/pending — filter to pending entries
  if (path === '/prices/pending') {
    const all = await offlineDb.getAll('priceEntries');
    return all.filter(e => e.status === 'pending');
  }

  // /prices with query params — filter price entries
  if (path.startsWith('/prices?') || path === '/prices') {
    return offlineDb.getAll('priceEntries');
  }

  // /items?search=... — filter items by search term
  const itemSearchMatch = path.match(/^\/items\?search=(.+)$/);
  if (itemSearchMatch) {
    const query = decodeURIComponent(itemSearchMatch[1]).toLowerCase();
    const all = await offlineDb.getAll('items');
    return all.filter(i => i.name?.toLowerCase().includes(query));
  }

  return null; // No special filtering — caller will use getAll
}

// ============================================================
// Failed Sync Sheet
// ============================================================

function openSyncFailureSheet() {
  syncQueue.getFailed().then(failed => {
    if (!failed.length) {
      offlineManager.hideSyncFailure();
      return;
    }

    const bodyHTML = `
      <p class="text-muted text-sm" style="margin-bottom:0.75rem">
        These changes were made offline but couldn\u2019t be saved to the server.
      </p>
      <div id="sync-failure-list">
        ${failed.map(item => `
          <div class="card" style="margin-bottom:0.5rem">
            <div class="card-body">
              <div class="card-title">${escapeHtml(item.operation)} ${escapeHtml(item.collection)}</div>
              <div class="card-subtitle text-muted">${escapeHtml(new Date(item.createdAt).toLocaleString())} &middot; ${item.attempts} attempt${item.attempts !== 1 ? 's' : ''}</div>
            </div>
            <div style="display:flex;gap:0.25rem;flex-shrink:0">
              <button class="btn btn-outline btn-sm" onclick="syncQueue.retry('${escapeAttr(item.id)}');closeModal()">Retry</button>
              <button class="btn btn-danger btn-sm" onclick="syncQueue.discard('${escapeAttr(item.id)}');closeModal()">Discard</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="form-actions" style="margin-top:0.75rem">
        <button class="btn btn-outline" onclick="closeModal()">Close</button>
      </div>`;

    openModal('Sync Issues', bodyHTML);
  });
}
