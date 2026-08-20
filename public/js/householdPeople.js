// Household people + preferred-name UI enhancements.
// Loaded after more.js so it can extend the existing account/household screens
// without duplicating the rest of the More-tab implementation.
(function initHouseholdPeopleUI() {
  const baseLoadAccountSettings = window.loadAccountSettings;
  const baseLoadHousehold = window.loadHousehold;

  function preferredName(user) {
    const explicit = (user?.displayName || '').trim();
    if (explicit) return explicit;
    return (user?.name || '').trim().split(/\s+/)[0] || 'User';
  }

  // Use household-friendly names in account-management cards while retaining
  // full names on the underlying account record.
  window.renderMemberCard = function renderMemberCardWithDisplayName(m, auth) {
    const isMe = String(m._id) === String(auth.user._id);
    const roleLabel = { owner: 'Owner', admin: 'Admin', member: 'Member' }[m.role] || 'Member';
    const name = preferredName(m);
    let actions = '';

    if (!isMe && auth.isOwner()) {
      if (m.role === 'member') {
        actions += `<button class="btn btn-outline btn-sm" onclick="setMemberRole('${m._id}','admin')">Make Admin</button>`;
      } else if (m.role === 'admin') {
        actions += `<button class="btn btn-outline btn-sm" onclick="setMemberRole('${m._id}','member')">Remove Admin</button>`;
      }
    }
    if (!isMe && auth.isAdmin() && m.role !== 'owner') {
      if (auth.isOwner() || m.role === 'member') {
        actions += `<button class="btn btn-danger btn-sm" onclick="removeMember('${m._id}')">Remove</button>`;
      }
    }

    return `
      <div class="member-card">
        <div class="member-avatar">${escapeHtml((name || '?')[0].toUpperCase())}</div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(name)}${isMe ? ' (you)' : ''}</div>
          <div class="member-role">${escapeHtml(roleLabel)}</div>
        </div>
        <div class="member-actions">${actions}</div>
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

      // The legacy form listener only submits name/email. A capture listener lets
      // this enhanced form submit all three fields in one request.
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();

        const name = document.getElementById('profile-name').value.trim();
        const displayName = document.getElementById('profile-display-name').value.trim();
        const email = document.getElementById('profile-email').value.trim();
        const submit = form.querySelector('button[type="submit"]');
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

  function renderHouseholdPerson(person, auth) {
    const linked = Boolean(person.userId);
    const canManage = auth.isAdmin();
    const subtitle = linked ? 'Account + meal planning' : 'Meal planning only';
    let actions = '';

    if (canManage) {
      actions += `<button class="btn btn-outline btn-sm" onclick="openEditHouseholdPersonModal('${person._id}','${escapeAttr(person.displayName)}')">Edit</button>`;
      if (!linked) {
        actions += `<button class="btn btn-danger btn-sm" onclick="removeHouseholdPerson('${person._id}','${escapeAttr(person.displayName)}')">Remove</button>`;
      }
    }

    return `
      <div class="member-card" data-person-id="${person._id}">
        <div class="member-avatar">${escapeHtml((person.displayName || '?')[0].toUpperCase())}</div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(person.displayName)}</div>
          <div class="member-role">${escapeHtml(subtitle)}</div>
        </div>
        <div class="member-actions">${actions}</div>
      </div>`;
  }

  if (typeof baseLoadHousehold === 'function') {
    window.loadHousehold = async function loadHouseholdWithPeople() {
      await baseLoadHousehold();

      const container = document.getElementById('household-content');
      if (!container) return;

      try {
        const { members = [], people = [] } = await api.household.get();
        const auth = window.appAuth;
        const memberTitle = [...container.querySelectorAll('h2.section-title')]
          .find(el => el.textContent.trim().startsWith('Members'));
        if (memberTitle) memberTitle.textContent = `Accounts (${members.length})`;

        const peopleSection = document.createElement('div');
        peopleSection.id = 'household-people-section';
        peopleSection.innerHTML = `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-top:0.75rem">
            <h2 class="section-title" style="padding-left:0;margin:0">People (${people.length})</h2>
            ${auth.isAdmin() ? '<button class="btn btn-primary btn-sm" onclick="openAddHouseholdPersonModal()">+ Add person</button>' : ''}
          </div>
          <p class="text-muted text-sm" style="margin:0.35rem 0 0.65rem">Everyone here can be selected in meal planning. A person does not need a login account.</p>
          <div id="household-people-list">
            ${people.length ? people.map(person => renderHouseholdPerson(person, auth)).join('') : '<div class="text-muted text-sm">No household people yet.</div>'}
          </div>`;

        if (memberTitle) {
          memberTitle.parentNode.insertBefore(peopleSection, memberTitle);
        } else {
          container.prepend(peopleSection);
        }
      } catch (err) {
        // The legacy household screen remains usable if this optional enhancement fails.
        console.error('Failed to load household people', err);
      }
    };
  }

  window.openAddHouseholdPersonModal = function openAddHouseholdPersonModal() {
    openModal('Add Household Person', `
      <form id="add-household-person-form">
        <div class="form-group">
          <label>Preferred name</label>
          <input class="form-control" id="new-household-person-name" maxlength="60" required autofocus placeholder="e.g. Wiz" />
          <div class="text-muted text-sm" style="margin-top:0.25rem">This creates a meal-planning person only. No email or login is required.</div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Add Person</button>
        </div>
      </form>`);

    document.getElementById('add-household-person-form').addEventListener('submit', async (event) => {
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
    openModal('Edit Preferred Name', `
      <form id="edit-household-person-form">
        <div class="form-group">
          <label>Preferred name</label>
          <input class="form-control" id="edit-household-person-name" value="${escapeAttr(currentName)}" maxlength="60" required />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`);

    document.getElementById('edit-household-person-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const displayName = document.getElementById('edit-household-person-name').value.trim();
      if (!displayName) return;
      try {
        const updated = await api.household.updatePerson(id, { displayName });
        if (String(updated.userId || '') === String(window.appAuth.user?._id || '')) {
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

  window.removeHouseholdPerson = async function removeHouseholdPerson(id, name) {
    if (!confirm(`Remove ${name} from household meal planning?`)) return;
    try {
      await api.household.removePerson(id);
      showToast(`${name} removed`);
      await window.loadHousehold();
    } catch (err) {
      handleError(err, 'Failed to remove person');
    }
  };

  // Load the unified grocery-entry override without forcing another large index.html edit.
  if (!document.querySelector('script[data-grocery-entry]')) {
    const script = document.createElement('script');
    script.src = '/js/groceryEntry.js';
    script.dataset.groceryEntry = 'true';
    script.async = false;
    script.onload = () => {
      // Catalog "Add Item" should ask for a first price rather than creating an
      // orphan catalog record. Capture phase prevents the legacy item-only modal.
      document.addEventListener('click', (event) => {
        const button = event.target.closest('#btn-add-item-catalog');
        if (!button || !window.appAuth?.isAdmin() || typeof window.openAddPriceModal !== 'function') return;

        event.preventDefault();
        event.stopImmediatePropagation();
        window.openAddPriceModal(null, async () => {
          showToast('Item and first price saved');
          if (typeof loadCatalog === 'function') await loadCatalog();
        });

        // Start the unified form directly in new-item mode.
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

  // csvImport.js has already loaded by the time this enhancement runs. Replace
  // only its final write loop so reviewed imports use the same atomic grocery API.
  if (!document.querySelector('script[data-csv-unified]')) {
    const script = document.createElement('script');
    script.src = '/js/csvImportUnified.js';
    script.dataset.csvUnified = 'true';
    script.async = false;
    script.onerror = () => console.error('Failed to load unified CSV import writer');
    document.head.appendChild(script);
  }
})();