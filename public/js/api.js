// Centralized API helper
const api = {
  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch('/api' + path, opts);

    // Redirect to login on auth failure
    if (res.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Not authenticated');
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
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
