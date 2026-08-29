// PRO-42: store-section organization layered around the existing shopping-list
// renderer. The purchase/check-off renderer stays authoritative and synchronous;
// this module only organizes the DOM after a render settles.
(() => {
  const SECTION_ORDER = [
    'Produce',
    'Meat & Seafood',
    'Dairy & Eggs',
    'Bakery',
    'Pantry',
    'Frozen',
    'Household',
    'Other'
  ];

  const CATEGORY_SECTIONS = new Map([
    ['produce', 'Produce'],
    ['meat & seafood', 'Meat & Seafood'],
    ['meat and seafood', 'Meat & Seafood'],
    ['meat', 'Meat & Seafood'],
    ['seafood', 'Meat & Seafood'],
    ['dairy', 'Dairy & Eggs'],
    ['dairy & eggs', 'Dairy & Eggs'],
    ['eggs', 'Dairy & Eggs'],
    ['bakery', 'Bakery'],
    ['bread', 'Bakery'],
    ['pantry', 'Pantry'],
    ['beverages', 'Pantry'],
    ['snacks', 'Pantry'],
    ['condiments & sauces', 'Pantry'],
    ['condiments and sauces', 'Pantry'],
    ['frozen', 'Frozen'],
    ['cleaning & household', 'Household'],
    ['cleaning and household', 'Household'],
    ['household', 'Household'],
    ['other', 'Other']
  ]);

  const confirmedSections = new Map();
  const baseLoadShoppingListTab = loadShoppingListTab;
  const baseLoadAboutSection = typeof loadAboutSection === 'function' ? loadAboutSection : null;
  let organizeFrame = null;
  let organizing = false;

  function inferredSection(category) {
    return CATEGORY_SECTIONS.get(String(category || '').trim().toLowerCase()) || 'Other';
  }

  function sectionForListItem(listItem) {
    const itemId = stringId(listItem?.itemId);
    return confirmedSections.get(itemId) || listItem?.itemId?.storeSection || inferredSection(listItem?.itemId?.category);
  }

  function addSectionControl(card, listItem, section) {
    const meta = card.querySelector('.list-item-meta');
    if (!meta || card.querySelector('.list-item-section-btn')) return;
    const name = listItem?.itemId?.name || 'item';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-item-section-btn';
    button.textContent = `${section} · edit section`;
    button.setAttribute('aria-label', `Edit store section for ${name}`);
    button.addEventListener('click', () => openStoreSectionPicker(listItem._id));
    meta.insertAdjacentElement('afterend', button);
  }

  function organizeStoreGroup(storeGroup) {
    const heading = storeGroup.querySelector(':scope > .list-store-heading');
    const cards = [...storeGroup.querySelectorAll(':scope > .list-item')];
    if (!heading || !cards.length) return;

    const groups = new Map(SECTION_ORDER.map(section => [section, []]));
    cards.forEach(card => {
      const listItem = listState.items.find(item => String(item._id) === String(card.dataset.id));
      if (!listItem) return;
      const section = sectionForListItem(listItem);
      groups.get(section)?.push({ card, listItem });
    });

    for (const section of SECTION_ORDER) {
      const entries = groups.get(section) || [];
      if (!entries.length) continue;

      const wrapper = document.createElement('div');
      wrapper.className = 'list-section-group';
      wrapper.dataset.section = section;
      wrapper.innerHTML = `
        <div class="list-section-heading">
          <h3>${escapeHtml(section)}</h3>
          <span>${entries.length}</span>
        </div>`;

      entries.forEach(({ card, listItem }) => {
        addSectionControl(card, listItem, section);
        wrapper.appendChild(card);
      });
      storeGroup.appendChild(wrapper);
    }
  }

  function organizeRenderedList() {
    const container = document.getElementById('shopping-list');
    if (!container || organizing) return;
    organizing = true;
    try {
      container.querySelectorAll(':scope > .list-store-group').forEach(organizeStoreGroup);
    } finally {
      organizing = false;
    }
  }

  function scheduleOrganization() {
    if (organizing || organizeFrame !== null) return;
    organizeFrame = requestAnimationFrame(() => {
      organizeFrame = null;
      organizeRenderedList();
    });
  }

  // Observe the List container instead of replacing renderShoppingList(). This
  // keeps optimistic check-off synchronous while section decoration waits until
  // the current render has settled.
  const listContainer = document.getElementById('shopping-list');
  if (listContainer) {
    const observer = new MutationObserver(() => {
      if (!organizing) scheduleOrganization();
    });
    observer.observe(listContainer, { childList: true, subtree: true });
  }

  loadShoppingListTab = async function loadShoppingListTabWithSections() {
    const container = document.getElementById('shopping-list');

    // Never expose stale List cards or a stale empty state while a new List load
    // is in flight. Apart from being clearer for users, this prevents consumers
    // from treating the previous render as the result of the current request.
    if (container) {
      container.setAttribute('aria-busy', 'true');
      container.innerHTML = '<div class="list-loading-state text-muted text-sm" role="status">Refreshing list…</div>';
    }

    try {
      try {
        const catalog = await api.items.list();
        confirmedSections.clear();
        catalog.forEach(item => {
          if (item.storeSection) confirmedSections.set(String(item._id), item.storeSection);
        });
      } catch (err) {
        // Category inference still works from each populated List item. A catalog
        // refresh failure must never block shopping.
        console.info('Store section preferences unavailable:', err.message);
      }

      const result = await baseLoadShoppingListTab();
      scheduleOrganization();
      return result;
    } finally {
      container?.removeAttribute('aria-busy');
    }
  };

  if (baseLoadAboutSection) {
    loadAboutSection = function loadAboutSectionWithStoreSections() {
      baseLoadAboutSection();
      const feature = [...document.querySelectorAll('#about-content li')]
        .find(item => item.textContent.trim().startsWith('Shopping list with'));
      if (feature) feature.textContent = 'Shopping list organized by store section with running cart total';
    };
  }

  window.openStoreSectionPicker = function openStoreSectionPicker(listItemId) {
    const listItem = listState.items.find(item => String(item._id) === String(listItemId));
    if (!listItem?.itemId?._id) return;
    const current = sectionForListItem(listItem);
    const itemName = listItem.itemId.name || 'item';

    openModal('Store section', `
      <form id="store-section-form">
        <p class="text-muted text-sm" style="margin-bottom:1rem">Where do you usually find <strong>${escapeHtml(itemName)}</strong>? This choice is remembered for your household.</p>
        <div class="form-group">
          <label for="store-section-select">Section</label>
          <select class="form-control" id="store-section-select">
            ${SECTION_ORDER.map(section => `<option value="${escapeAttr(section)}"${section === current ? ' selected' : ''}>${escapeHtml(section)}</option>`).join('')}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save section</button>
        </div>
      </form>`);

    document.getElementById('store-section-form').addEventListener('submit', async event => {
      event.preventDefault();
      const submit = formSubmitButton(event.target);
      const storeSection = document.getElementById('store-section-select').value;
      submit.disabled = true;
      try {
        const updated = await api.put(`/item-sections/${listItem.itemId._id}`, { storeSection });
        confirmedSections.set(String(listItem.itemId._id), updated.storeSection);
        listItem.itemId.storeSection = updated.storeSection;
        closeModal();
        renderShoppingList();
        showToast(`${itemName} will appear under ${updated.storeSection}`);
      } catch (err) {
        submit.disabled = false;
        handleError(err, 'Failed to save store section');
      }
    });
  };

  const style = document.createElement('style');
  style.textContent = `
    .list-store-group, .list-section-group, .list-section-heading, .list-store-heading, .list-section-group .list-item { min-width:0; max-width:100%; }
    .list-store-heading, .list-section-heading { flex-wrap:wrap; }
    .list-store-heading h2, .list-section-heading h3 { min-width:0; overflow-wrap:anywhere; }
    .list-store-heading span, .list-section-heading span { flex:0 1 auto; min-width:0; }
    .list-section-group { margin:.25rem 0 .85rem; }
    .list-section-heading { display:flex; align-items:center; justify-content:space-between; gap:.4rem .75rem; padding:.45rem .2rem .35rem; }
    .list-section-heading h3 { margin:0; font-size:.78rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-muted); }
    .list-section-heading span { font-size:.75rem; color:var(--text-muted); }
    .list-section-group .list-item { margin-bottom:.45rem; }
    .list-item-section-btn { display:block; max-width:100%; margin:.2rem 0 0; padding:0; border:0; background:none; color:var(--primary); font:inherit; font-size:.75rem; cursor:pointer; text-align:left; white-space:normal; overflow-wrap:anywhere; }
    .list-item-section-btn:focus-visible { outline:2px solid var(--primary); outline-offset:2px; border-radius:2px; }
    .list-loading-state { padding:1rem .25rem; }
  `;
  document.head.appendChild(style);
})();
