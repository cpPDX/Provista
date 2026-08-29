(() => {
  const dialog = document.getElementById('auth-dialog');
  const tabList = dialog.querySelector('.auth-tabs');
  const tabs = [...dialog.querySelectorAll('[data-auth-tab]')];
  const views = {
    signin: document.getElementById('signin-panel'),
    signup: document.getElementById('signup-panel'),
    household: document.getElementById('household-panel'),
    'create-household': document.getElementById('create-household-panel'),
    'join-household': document.getElementById('join-household-panel'),
    forgot: document.getElementById('forgot-panel')
  };
  let pendingUser = null;

  function setError(id, message = '') {
    const element = document.getElementById(id);
    element.textContent = message;
    element.hidden = !message;
  }

  function setLoading(button, loading, idleLabel, loadingLabel) {
    button.disabled = loading;
    button.textContent = loading ? loadingLabel : idleLabel;
  }

  async function postJSON(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  function showView(name, focus = true) {
    const viewName = views[name] ? name : 'signin';
    const tabView = viewName === 'signin' || viewName === 'signup';
    tabList.hidden = !tabView;
    tabs.forEach(tab => {
      const active = tab.dataset.authTab === viewName;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    Object.entries(views).forEach(([key, panel]) => {
      panel.hidden = key !== viewName;
    });
    if (focus) {
      const target = views[viewName].querySelector('input, button:not(.auth-back)') || views[viewName].querySelector('button');
      target?.focus({ preventScroll: true });
    }
  }

  function openDialog(mode = 'signin') {
    showView(mode, false);
    if (!dialog.open) dialog.showModal();
    const target = views[mode]?.querySelector('input, button:not(.auth-back)');
    target?.focus({ preventScroll: true });
  }

  function clearAuthQuery() {
    if (new URLSearchParams(window.location.search).has('auth')) {
      history.replaceState({}, '', window.location.pathname);
    }
  }

  function closeDialog() {
    dialog.close();
    clearAuthQuery();
  }

  document.querySelectorAll('[data-open-auth]').forEach(button => {
    button.addEventListener('click', () => openDialog(button.dataset.openAuth));
  });
  dialog.querySelector('[data-close-auth]').addEventListener('click', closeDialog);
  dialog.addEventListener('click', event => {
    if (event.target === dialog) closeDialog();
  });
  dialog.addEventListener('cancel', clearAuthQuery);
  tabs.forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.authTab)));
  dialog.querySelectorAll('[data-auth-view]').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.authView));
  });

  const requestedMode = new URLSearchParams(window.location.search).get('auth');
  if (requestedMode === 'signin' || requestedMode === 'signup') openDialog(requestedMode);

  document.getElementById('landing-signin-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    setError('landing-signin-error');
    setLoading(button, true, 'Sign in', 'Signing in…');
    try {
      await postJSON('/api/auth/login', {
        email: form.email.value.trim(),
        password: form.password.value
      });
      window.location.href = '/';
    } catch (err) {
      setError('landing-signin-error', err.message);
      setLoading(button, false, 'Sign in', 'Signing in…');
    }
  });

  document.getElementById('landing-signup-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    setError('landing-signup-error');
    if (form.password.value.length < 8) {
      setError('landing-signup-error', 'Password must be at least 8 characters');
      return;
    }
    pendingUser = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value
    };
    showView('household');
  });

  document.getElementById('landing-create-household-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    if (!pendingUser) return showView('signup');
    setError('landing-create-error');
    setLoading(button, true, 'Create household', 'Creating…');
    try {
      const data = await postJSON('/api/auth/register', {
        ...pendingUser,
        action: 'create',
        householdName: form.householdName.value.trim()
      });
      if (data.user?._id) localStorage.setItem(`gt_new_household_${data.user._id}`, '1');
      window.location.href = '/';
    } catch (err) {
      setError('landing-create-error', err.message);
      setLoading(button, false, 'Create household', 'Creating…');
    }
  });

  const inviteCode = document.getElementById('landing-invite-code');
  inviteCode.addEventListener('input', () => {
    inviteCode.value = inviteCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });

  document.getElementById('landing-join-household-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    if (!pendingUser) return showView('signup');
    setError('landing-join-error');
    setLoading(button, true, 'Join household', 'Joining…');
    try {
      await postJSON('/api/auth/register', {
        ...pendingUser,
        action: 'join',
        inviteCode: form.inviteCode.value.trim()
      });
      window.location.href = '/';
    } catch (err) {
      setError('landing-join-error', err.message);
      setLoading(button, false, 'Join household', 'Joining…');
    }
  });

  document.getElementById('landing-forgot-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = document.getElementById('landing-forgot-message');
    setError('landing-forgot-error');
    message.hidden = true;
    message.textContent = '';
    setLoading(button, true, 'Send reset link', 'Sending…');
    try {
      const data = await postJSON('/api/auth/forgot-password', { email: form.email.value.trim() });
      message.textContent = data.message;
      if (data.resetUrl) {
        const link = document.createElement('a');
        link.href = data.resetUrl;
        link.textContent = 'Open local reset link';
        message.append(' ', link);
      }
      message.hidden = false;
    } catch (err) {
      setError('landing-forgot-error', err.message);
    } finally {
      setLoading(button, false, 'Send reset link', 'Sending…');
    }
  });
})();
