// Centralized API helper
const api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get: (path) => api.request('GET', path),
  post: (path, body) => api.request('POST', path, body),
  put: (path, body) => api.request('PUT', path, body),
  delete: (path) => api.request('DELETE', path),

  // Convenience methods
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
    create: (data) => api.post('/prices', data),
    delete: (id) => api.delete(`/prices/${id}`)
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
  }
};
