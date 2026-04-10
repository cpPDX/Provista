// Centralized API helper with offline support
const api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    // Check if offline features are available
    const hasOffline = typeof offlineDb !== 'undefined' && window.appAuth?.features?.offlineAccess;

    try {
      const res = await fetch('/api' + path, opts);

      // Handle structured offline error from service worker
      if (res.status === 503) {
        const data = await res.json().catch(() => ({}));
        if (data.offline && hasOffline) {
          return this._offlineFallback(method, path, body);
        }
      }

      // Redirect to login on auth failure (but not if offline)
      if (res.status === 401) {
        if (!offlineManager?.isOnline && hasOffline) {
          return this._offlineFallback(method, path, body);
        }
        window.location.href = '/login.html';
        throw new Error('Not authenticated');
      }

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`HTTP ${res.status}: invalid JSON response`);
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // On successful write, update IndexedDB cache
      if (hasOffline && method !== 'GET' && data._id) {
        const store = resolveStore(path);
        if (store) offlineDb.put(store, data).catch(() => {});
      }

      return data;
    } catch (err) {
      // Network error — try offline fallback
      if (hasOffline && (err.name === 'TypeError' || err.message === 'Failed to fetch')) {
        return this._offlineFallback(method, path, body);
      }
      throw err;
    }
  },

  // Offline fallback: reads from IndexedDB, writes go to sync queue
  async _offlineFallback(method, path, body) {
    const store = resolveStore(path);

    if (method === 'GET') {
      if (!store) throw new Error('This data is not available offline');
      const data = await offlineDb.getAll(store);
      return data;
    }

    // Write operations: save to IndexedDB + sync queue
    if (!store) throw new Error('Cannot save this data offline');

    const operation = method === 'POST' ? 'CREATE' : method === 'PUT' ? 'UPDATE' : 'DELETE';

    if (method === 'DELETE') {
      // Extract ID from path (e.g., /items/abc123)
      const parts = path.split('/');
      const id = parts[parts.length - 1];
      if (id && id !== parts[1]) {
        await offlineDb.delete(store, id);
      }
      await syncQueue.add(operation, store, null, path, method);
      showToast('Saved offline. Will sync when back online.', 3000);
      return { success: true };
    }

    // POST/PUT: store optimistic data locally
    const optimistic = { ...body };
    if (!optimistic._id) {
      optimistic._id = 'offline_' + crypto.randomUUID();
    }
    await offlineDb.put(store, optimistic);
    await syncQueue.add(operation, store, body, path, method);
    showToast('Saved offline. Will sync when back online.', 3000);
    return optimistic;
  },
  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
  put: (path, body) => api.request('PUT', path, body),
  delete: (path) => api.request('DELETE', path),

  items: {
    search: (q) => api.get(`/items?search=${encodeURIComponent(q)}`),
    list: () => api.get('/items'),
    create: (data) => api.post('/items', data),
    update: (id, data) => api.put(`/items/${id}`, data),
    delete: (id) => api.delete(`/items/${id}`)
  },
  stores: {
    list: () => api.get('/stores'),
    create: (data) => api.post('/stores', data),
    update: (id, data) => api.put(`/stores/${id}`, data),
    delete: (id) => api.delete(`/stores/${id}`)
  },
  prices: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return api.get('/prices' + (qs ? '?' + qs : ''));
    },
    history: (itemId) => api.get(`/prices/history/${itemId}`),
    compare: (itemId) => api.get(`/prices/compare/${itemId}`),
    pending: () => api.get('/prices/pending'),
    create: (data) => api.post('/prices', data),
    approve: (id, edits) => api.put(`/prices/${id}/approve`, edits || {}),
    reject: (id) => api.delete(`/prices/${id}/reject`),
    delete: (id) => api.delete(`/prices/${id}`),
    lastPurchased: (itemId) => api.get(`/prices/last-purchased/${itemId}`)
  },
  inventory: {
    list: () => api.get('/inventory'),
    save: (data) => api.post('/inventory', data),
    update: (id, data) => api.put(`/inventory/${id}`, data),
    delete: (id) => api.delete(`/inventory/${id}`)
  },
  shoppingList: {
    list: () => api.get('/shopping-list'),
    add: (data) => api.post('/shopping-list', data),
    update: (id, data) => api.put(`/shopping-list/${id}`, data),
    delete: (id) => api.delete(`/shopping-list/${id}`),
    clear: (checkedOnly = false) => api.delete(`/shopping-list${checkedOnly ? '?checkedOnly=true' : ''}`)
  },
  spend: {
    month: (month) => api.get(`/spend?month=${month}`),
    summary: () => api.get('/spend/summary')
  },
  auth: {
    updateProfile: (data) => api.put('/auth/profile', data),
    changePassword: (data) => api.put('/auth/password', data),
    deleteAccount: (data) => api.request('DELETE', '/auth/account', data)
  },
  household: {
    get: () => api.get('/household'),
    update: (data) => api.put('/household', data),
    getInvite: () => api.get('/household/invite'),
    regenerateInvite: () => api.post('/household/invite', {}),
    removeMember: (id) => api.delete(`/household/members/${id}`),
    updateMemberRole: (id, role) => api.put(`/household/members/${id}`, { role }),
    deleteHousehold: (data) => api.request('DELETE', '/household', data)
  }
};
