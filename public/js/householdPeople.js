// Household people + preferred-name UI enhancements.
// Loaded after more.js so household-facing account/person concepts can be
// presented as one roster without changing the underlying data model.
(function initHouseholdPeopleUI() {
  const baseLoadAccountSettings = window.loadAccountSettings;
  const baseLoadHousehold = window.loadHousehold;
  const rosterState = { members: [], people: [] };

  function preferredName(user) {
    const explicit = (user?.displayName || '').trim();
    if (explicit) return explicit;
    return (user?.name || '').trim().split(/\s+/)[0] || 'User';
  }

  function idOf(value) {
    return String(value?._id || value || '');
  }

  function roleLabel(role) {
    return { owner: 'Owner', admin: 'Admin', member: 'Member' }[role] || 'Member';
  }

  function memberById(memberId) {
    return rosterState.members.find(member => idOf(member) === idOf(memberId));
  }

  function personByUserId(userId) {
    return rosterState.people.find(person => idOf(person.userId) === idOf(userId));
  }

  // Preserve preferred-name rendering anywhere the legacy member cards are
  // temporarily rendered before the unified roster replaces them.
  window.renderMemberCard = function renderMemberCardWithDisplayName(member, auth) {
    const isMe = idOf(member) === idOf(auth.user?._id);
    const name = preferredName(member);
    return `
      <div class="member-card">
        <div class="member-avatar">${escapeHtml((name || '?')[0].toUpperCase())}</div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(name)}${isMe ? ' (you)' : ''}</div>
          <div class="member-role">${escapeHtml(roleLabel(member.role))} · Can sign in</div>
        </div>
      </div>`;
  };

  if (typeof baseLoadAccountSettings === 'function') {
    window.loadAccountSettings = async function loadAccountSettingsWithDisplayName() {
      await baseLoadAccountSettings();

      const auth = window.appAuth;
      const form = document.getElementById('profile-form');
      const nameInput = document.getElementById('profile-name');
      if (!form || !nameInput || document.getElementById('profile-display-name')) return;

      const nameGroup = nameInput.closest('.form-group');
      if (nameGroup?.querySelector('label')) nameGroup.querySelector('label').textContent = 'Full name';
      nameGroup?.insertAdjacentHTML('afterend', `
        <div class="form-group">
          <label>Preferred name</label>
          <input class="form-control" id="profile-display-name" value="${escapeAttr(auth.user.displayName || preferredName(auth.user))}" maxlength="60" placeholder="e.g. Chris, Hus, Wiz" />
          <div class="text-muted text-sm" style="margin-top:0.25rem">Shown to your household in meal planning and shared screens.</div>
        </div>`);

      form.addEventListener('submit', async event => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const name = document.getElementById('profile-name').value.trim();
        const displayName = document.getElementById('profile-display-name').value.trim();
        const email = document.getElementById('profile-email').value.trim();
        const submit = formSubmitButton(form);
        if (submit) submit.disabled = true;

        try {
          const { user: updated } = await api.auth.updateProfile({ name, displayName, email });
          auth.user = { ...auth.user, ...updated };
          auth._saveToCache?.();
          const label = document.getElementById('user-label');
          if (label) label.textContent = preferredName(updated);
          showToast('Profile updated');
        } catch (err) {
          handleError(err, 'Failed to update profile');
        } finally {
          if (submit) submit.disabled = false;
        }
      }, true);
    };
  }

  function rosterActions(person, member, auth) {
    if (!auth.isAdmin()) return '';
    const linked = Boolean(member);
    const isMe = linked && idOf(member) === idOf(auth.user?._id);
    let actions = '';

    if (person?._id) {
      const nameArg = escapeAttr(JSON.stringify(person.displayName || preferredName(member)));
      actions += `<button class="btn btn-outline btn-sm" onclick="openEditHouseholdPersonModal('${escapeAttr(person._id)}',${nameArg})">Edit name</button>`;
    }

    if (linked && !isMe && auth.isOwner()) {
      if (member.role === 'member') {
        actions += `<button class="btn btn-outline btn-sm" onclick="setMemberRole('${escapeAttr(member._id)}','admin')">Make Admin</button>`;
      } else if (member.role === 'admin') {
        actions += `<button class="btn btn-outline btn-sm" onclick="setMemberRole('${escapeAttr(member._id)}','member')">Remove Admin</button>`;
      }
    }

    if (linked && !isMe && member.role !== 'owner' && (auth.isOwner() || member.role === 'member')) {
      actions += `<button class="btn btn-danger btn-sm" onclick="removeMember('${escapeAttr(member._id)}')">Remove access</button>`;
    } else if (!linked && person?._id) {
      const nameArg = escapeAttr(JSON.stringify(person.displayName || 'Person'));
      actions += `<button class="btn btn-danger btn-sm" onclick="removeHouseholdPerson('${escapeAttr(person._id)}',${nameArg})">Remove person</button>`;
    }
    return actions;
  }

  function renderRosterRow(person, member, auth) {
    const linked = Boolean(member);
    const isMe = linked && idOf(member) === idOf(auth.user?._id);
    const name = (person?.displayName || preferredName(member)).trim() || 'Person';
    const state = linked ? `${roleLabel(member.role)} · Can sign in` : 'Planning only';
    const key = person?._id || member?._id || name;
    return `
      <div class="member-card" data-roster-id="${escapeAttr(key)}">
        <div class="member-avatar">${escapeHtml(name[0].toUpperCase())}</div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(name)}${isMe ? ' (you)' : ''}</div>
          <div class="member-role">${escapeHtml(state)}</div>
        </div>
        <div class="member-actions">${rosterActions(person, member, auth)}</div>
      </div>`;
  }

  function renderUnifiedRoster(container, members, people, auth) {
    const linkedUserIds = new Set();
    const rows = [];

    people.forEach(person => {
      const member = person.userId ? memberById(person.userId) : null;
      if (member) linkedUserIds.add(idOf(member));
      rows.push({ person, member });
    });

    // Defensive fallback: an account should normally have a linked Person, but
    // never make an account disappear from the household UI if sync is incomplete.
    members.forEach(member => {
      if (!linkedUserIds.has(idOf(member)) && !personByUserId(member._id)) {
        rows.push({ person: null, member });
      }
    });

    rows.sort((a, b) => {
      const aLinked = a.member ? 0 : 1;
      const bLinked = b.member ? 0 : 1;
      if (aLinked !== bLinked) return aLinked - bLinked;
      const aName = a.person?.displayName || preferredName(a.member);
      const bName = b.person?.displayName || preferredName(b.member);
      return aName.localeCompare(bName);
    });

    const legacyTitle = [...container.querySelectorAll('h2.section-title')]
      .find(element => /^(Members|Accounts)\b/.test(element.textContent.trim()));
    const legacyList = document.getElementById('members-list');

    const section = document.createElement('section');
    section.id = 'household-roster-section';
    section.innerHTML = `
      <div class="household-roster-heading">
        <div>
          <h2 class="section-title" style="padding-left:0;margin:0">Our household</h2>
          <p class="text-muted text-sm">Everyone appears once. “Can sign in” means they have Provista account access; “Planning only” is for people who only need to appear in meal plans.</p>
        </div>
        ${auth.isAdmin() ? '<button class="btn btn-primary btn-sm" onclick="openAddHouseholdPersonModal()">+ Add person</button>' : ''}
      </div>
      <div id="household-roster-list">
        ${rows.length ? rows.map(row => renderRosterRow(row.person, row.member, auth)).join('') : '<div class="text-muted text-sm">No household people yet.</div>'}
      </div>`;

    if (legacyTitle) legacyTitle.parentNode.insertBefore(section, legacyTitle);
    else container.prepend(section);
    legacyTitle?.remove();
    legacyList?.remove();
  }

  function simplifyShoppingDefaults(container) {
    const form = container.querySelector('#household-shopping-settings');
    if (!form) return;

    const savings = document.getElementById('household-savings-threshold');
    const freshness = document.getElementById('household-price-freshness');
    const strict = document.getElementById('household-strict-price-review');
    savings?.closest('.form-group')?.querySelector('label')?.replaceChildren(document.createTextNode('Suggest another store when we’d save at least ($)'));
    freshness?.closest('.form-group')?.querySelector('label')?.replaceChildren(document.createTextNode('Ignore prices older than… (days)'));

    const strictRow = strict?.closest('.trip-pantry-option');
    if (strictRow) {
      const strong = strictRow.querySelector('strong');
      const small = strictRow.querySelector('small');
      if (strong) strong.textContent = 'Require Admin approval for shopping prices';
      if (small) small.textContent = 'Advanced safeguard for households that want shopping-trip prices reviewed before approval.';
    }

    const freshnessGroup = freshness?.closest('.form-group');
    const formRow = savings?.closest('.form-row');
    if (formRow && savings) {
      const savingsGroup = savings.closest('.form-group');
      form.insertBefore(savingsGroup, formRow);
      if (!formRow.children.length) formRow.remove();
    }

    if (freshnessGroup || strictRow) {
      const details = document.createElement('details');
      details.className = 'household-advanced-settings';
      details.innerHTML = '<summary>Advanced shopping settings</summary>';
      if (freshnessGroup) details.appendChild(freshnessGroup);
      if (strictRow) details.appendChild(strictRow);
      const submit = form.querySelector('button[type="submit"]');
      form.insertBefore(details, submit);
    }
  }

  function bindEnhancedInviteEntry() {
    const original = document.getElementById('btn-show-invite');
    if (!original) return;
    const replacement = original.cloneNode(true);
    replacement.textContent = 'Show invite';
    original.replaceWith(replacement);
    replacement.addEventListener('click', loadEnhancedInviteCode);
  }

  if (typeof baseLoadHousehold === 'function') {
    window.loadHousehold = async function loadHouseholdWithUnifiedRoster() {
      await baseLoadHousehold();
      const container = document.getElementById('household-content');
      if (!container) return;

      try {
        const { members = [], people = [] } = await api.household.get();
        rosterState.members = members;
        rosterState.people = people;
        renderUnifiedRoster(container, members, people, window.appAuth);
        simplifyShoppingDefaults(container);
        bindEnhancedInviteEntry();
      } catch (err) {
        console.error('Failed to load unified household roster', err);
      }
    };
  }

  window.openAddHouseholdPersonModal = function openAddHouseholdPersonModal() {
    openModal('Add person', `
      <form id="add-household-person-form">
        <div class="form-group">
          <label>Preferred name</label>
          <input class="form-control" id="new-household-person-name" maxlength="60" required autofocus placeholder="e.g. Wiz" />
          <div class="text-muted text-sm" style="margin-top:0.25rem">Planning-only people can appear in meals without needing an email or sign-in account.</div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Add person</button>
        </div>
      </form>`);

    document.getElementById('add-household-person-form').addEventListener('submit', async event => {
      event.preventDefault();
      const displayName = document.getElementById('new-household-person-name').value.trim();
      if (!displayName) return;
      try {
        await api.household.addPerson(displayName);
        closeModal();
        showToast(`${displayName} added`);
        await window.loadHousehold();
      } catch (err) {
        handleError(err, 'Failed to add person');
      }
    });
  };

  window.openEditHouseholdPersonModal = function openEditHouseholdPersonModal(id, currentName) {
    openModal('Edit preferred name', `
      <form id="edit-household-person-form">
        <div class="form-group">
          <label>Preferred name</label>
          <input class="form-control" id="edit-household-person-name" value="${escapeAttr(currentName)}" maxlength="60" required />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save name</button>
        </div>
      </form>`);

    document.getElementById('edit-household-person-form').addEventListener('submit', async event => {
      event.preventDefault();
      const displayName = document.getElementById('edit-household-person-name').value.trim();
      if (!displayName) return;
      try {
        const updated = await api.household.updatePerson(id, { displayName });
        if (idOf(updated.userId) === idOf(window.appAuth.user?._id)) {
          window.appAuth.user.displayName = updated.displayName;
          window.appAuth._saveToCache?.();
          const label = document.getElementById('user-label');
          if (label) label.textContent = updated.displayName;
        }
        closeModal();
        showToast('Preferred name updated');
        await window.loadHousehold();
      } catch (err) {
        handleError(err, 'Failed to update person');
      }
    });
  };

  window.setMemberRole = async function setMemberRoleWithConfirmation(memberId, role) {
    const member = memberById(memberId);
    const name = preferredName(member);
    const makeAdmin = role === 'admin';
    const confirmed = await confirmAction({
      title: makeAdmin ? `Make ${name} an Admin?` : `Remove ${name}’s Admin access?`,
      message: makeAdmin
        ? `${name} will be able to manage household settings, stores, products, and invites. Their account stays in the household.`
        : `${name} will keep household access as a Member but will no longer manage household settings.`,
      confirmLabel: makeAdmin ? 'Make Admin' : 'Remove Admin',
      danger: false
    });
    if (!confirmed) return;
    try {
      await api.household.updateMemberRole(memberId, role);
      showToast(makeAdmin ? `${name} is now an Admin` : `${name} is now a Member`);
      await window.loadHousehold();
    } catch (err) {
      handleError(err, 'Failed to update role');
    }
  };

  window.removeMember = async function removeMemberWithConfirmation(memberId) {
    const member = memberById(memberId);
    const name = preferredName(member);
    const confirmed = await confirmAction({
      title: `Remove ${name}’s household access?`,
      message: `${name} will no longer be able to sign in to this household. Shared shopping history, Pantry data, and household records stay in Provista.`,
      confirmLabel: 'Remove access'
    });
    if (!confirmed) return;
    try {
      await api.household.removeMember(memberId);
      showToast(`${name} access removed`);
      await window.loadHousehold();
    } catch (err) {
      handleError(err, 'Failed to remove household access');
    }
  };

  window.removeHouseholdPerson = async function removeHouseholdPerson(id, name) {
    const confirmed = await confirmAction({
      title: `Remove ${name} from planning?`,
      message: `${name} will no longer appear as a meal-planning person. Products, Pantry, shopping history, and account access are not deleted.`,
      confirmLabel: 'Remove person'
    });
    if (!confirmed) return;
    try {
      await api.household.removePerson(id);
      showToast(`${name} removed from planning`);
      await window.loadHousehold();
    } catch (err) {
      handleError(err, 'Failed to remove person');
    }
  };

  async function copyInviteCode(inviteCode) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteCode);
      } else {
        const input = document.createElement('textarea');
        input.value = inviteCode;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
      showToast('Invite code copied');
    } catch (err) {
      handleError(err, 'Could not copy invite code');
    }
  }

  async function shareInvite(inviteCode) {
    const shareData = {
      title: 'Join our Provista household',
      text: `Join our Provista household with invite code ${inviteCode}.`
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    await copyInviteCode(inviteCode);
  }

  async function loadEnhancedInviteCode() {
    const section = document.getElementById('invite-section');
    if (!section) return;
    section.innerHTML = '<div class="spinner" style="margin:1rem auto"></div>';
    try {
      const { inviteCode, expiresAt } = await api.household.getInvite();
      const expStr = new Date(expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const qrSrc = `/api/household/invite/qr?t=${Date.now()}`;
      section.innerHTML = `
        <div class="invite-code-display">
          <div class="invite-code-value">${escapeHtml(inviteCode)}</div>
          <div class="invite-code-expiry">Expires ${escapeHtml(expStr)}</div>
          <img class="qr-img" src="${qrSrc}" alt="Join Provista household QR code" width="180" height="180" />
        </div>
        <div class="invite-primary-actions">
          <button class="btn btn-primary" id="btn-share-invite">Share invite</button>
          <button class="btn btn-outline" id="btn-copy-invite">Copy code</button>
        </div>
        <button class="btn-link" id="btn-regen-invite" style="margin-top:0.75rem">Regenerate code</button>`;

      document.getElementById('btn-share-invite')?.addEventListener('click', () => shareInvite(inviteCode));
      document.getElementById('btn-copy-invite')?.addEventListener('click', () => copyInviteCode(inviteCode));
      document.getElementById('btn-regen-invite')?.addEventListener('click', async event => {
        const confirmed = await confirmAction({
          title: 'Create a new invite code?',
          message: 'The current invite code will stop working.',
          confirmLabel: 'Create new code'
        });
        if (!confirmed) return;
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await api.household.regenerateInvite();
          showToast('New invite code generated');
          await loadEnhancedInviteCode();
        } catch (err) {
          handleError(err, 'Failed to create a new invite code');
          button.disabled = false;
        }
      });
    } catch (err) {
      section.innerHTML = '<p class="text-danger text-sm">Failed to load invite code.</p>';
    }
  }

  // Load the unified grocery-entry override without forcing another large index.html edit.
  if (!document.querySelector('script[data-grocery-entry]')) {
    const script = document.createElement('script');
    script.src = '/js/groceryEntry.js';
    script.dataset.groceryEntry = 'true';
    script.async = false;
    script.onload = () => {
      document.addEventListener('click', event => {
        const button = event.target.closest('#btn-add-item-catalog');
        if (!button || !window.appAuth?.isAdmin() || typeof window.openAddPriceModal !== 'function') return;

        event.preventDefault();
        event.stopImmediatePropagation();
        window.openAddPriceModal(null, async () => {
          showToast('Item and first price saved');
          if (typeof loadCatalog === 'function') await loadCatalog();
        });

        const mode = document.getElementById('price-new-item-mode');
        const panel = document.getElementById('price-new-item');
        const itemId = document.getElementById('price-item-id');
        const context = document.getElementById('price-item-context');
        if (mode) mode.value = 'true';
        if (panel) panel.style.display = '';
        if (itemId) itemId.value = '';
        if (context) context.style.display = 'none';
        document.getElementById('price-item-input')?.focus();
      }, true);
    };
    script.onerror = () => console.error('Failed to load unified grocery entry UI');
    document.head.appendChild(script);
  }

  if (!document.querySelector('script[data-csv-unified]')) {
    const script = document.createElement('script');
    script.src = '/js/csvImportUnified.js';
    script.dataset.csvUnified = 'true';
    script.async = false;
    script.onerror = () => console.error('Failed to load unified CSV import writer');
    document.head.appendChild(script);
  }
})();
