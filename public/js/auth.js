// Auth state — loaded before any other JS by app.js
window.appAuth = {
  user: null,
  household: null,

  isAdmin() { return ['admin', 'owner'].includes(this.user?.role); },
  isOwner() { return this.user?.role === 'owner'; },
  isMember() { return this.user?.role === 'member'; },

  async load() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.status === 401) {
        window.location.href = '/login.html';
        return false;
      }
      const data = await res.json();
      this.user = data.user;
      this.household = data.household;
      return true;
    } catch (err) {
      window.location.href = '/login.html';
      return false;
    }
  },

  async logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  }
};
