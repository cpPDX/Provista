// Auth state — loaded before any other JS by app.js
window.appAuth = {
  user: null,
  household: null,
  features: null,
  offlineSession: false, // true when using cached auth (session may be expired)

  isAdmin() { return ['admin', 'owner'].includes(this.user?.role); },
  isOwner() { return this.user?.role === 'owner'; },
  isMember() { return this.user?.role === 'member'; },

  async load() {
    try {
      const res = await fetch('/api/auth/me');

      // Handle offline response from service worker
      if (res.status === 503) {
        const data = await res.json().catch(() => ({}));
        if (data.offline) return this._loadFromCache();
      }

      if (res.status === 401) {
        // If offline, try cached auth instead of redirecting
        if (!navigator.onLine) return this._loadFromCache();
        window.location.href = '/login.html';
        return false;
      }

      const data = await res.json();
      this.user = data.user;
      this.household = data.household;
      this.features = data.features || { offlineAccess: false, advancedAnalytics: false };
      this.offlineSession = false;

      // Cache auth data for offline use
      this._saveToCache();
      return true;
    } catch (err) {
      // Network error — try offline fallback
      return this._loadFromCache();
    }
  },

  _saveToCache() {
    try {
      localStorage.setItem('provista_auth', JSON.stringify({
        user: this.user,
        household: this.household,
        features: this.features,
        cachedAt: new Date().toISOString()
      }));
    } catch {}
  },

  _loadFromCache() {
    try {
      const cached = localStorage.getItem('provista_auth');
      if (!cached) {
        // No cached auth — cannot work offline without prior login
        window.location.href = '/login.html';
        return false;
      }
      const data = JSON.parse(cached);
      this.user = data.user;
      this.household = data.household;
      this.features = data.features || { offlineAccess: false, advancedAnalytics: false };
      this.offlineSession = true;
      return true;
    } catch {
      window.location.href = '/login.html';
      return false;
    }
  },

  async logout() {
    localStorage.removeItem('provista_auth');
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login.html';
  }
};
