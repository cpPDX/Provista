// Reusable autocomplete for items and stores

/**
 * attachItemAutocomplete(inputEl, dropdownEl, opts)
 * opts.onSelect(item) - called when item is selected
 * opts.onCreateNew(name) - called when user wants to create new item
 * opts.minChars - default 2
 */
function attachItemAutocomplete(inputEl, dropdownEl, opts = {}) {
  const minChars = opts.minChars ?? 2;
  let debounceTimer;
  if (!dropdownEl.id) dropdownEl.id = `item-options-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  inputEl.setAttribute('role', 'combobox');
  inputEl.setAttribute('aria-autocomplete', 'list');
  inputEl.setAttribute('aria-controls', dropdownEl.id);
  inputEl.setAttribute('aria-expanded', 'false');
  dropdownEl.setAttribute('role', 'listbox');

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const val = inputEl.value.trim();
    if (val.length < minChars) {
      closeDropdown();
      return;
    }
    debounceTimer = setTimeout(async () => {
      try {
        const items = await api.items.search(val);
        renderItemDropdown(items, val);
      } catch (e) {
        console.error('Item autocomplete search failed:', e);
        closeDropdown();
      }
    }, 200);
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      if (!inputEl.closest('.autocomplete-wrap')?.contains(document.activeElement)) closeDropdown();
    }, 150);
  });
  inputEl.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      const firstOption = dropdownEl.querySelector('button');
      if (firstOption) { event.preventDefault(); firstOption.focus(); }
    } else if (event.key === 'Escape') {
      closeDropdown();
    }
  });

  function renderItemDropdown(items, query) {
    dropdownEl.innerHTML = '';
    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'autocomplete-item';
      button.setAttribute('role', 'option');
      button.innerHTML = `<div class="autocomplete-item-name">${escapeHtml(item.name)}${item.brand ? ' <span class="text-muted text-sm">(' + escapeHtml(item.brand) + ')</span>' : ''}</div>
        <div class="autocomplete-item-meta">${formatItemMeta(item)}${item.isOrganic ? ' <span class="badge badge-organic">Organic</span>' : ''}</div>`;
      button.addEventListener('click', () => {
        inputEl.value = item.name;
        closeDropdown();
        if (opts.onSelect) opts.onSelect(item);
      });
      dropdownEl.appendChild(button);
    });

    // "Create new" option
    if (opts.onCreateNew) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'autocomplete-create';
      button.setAttribute('role', 'option');
      button.textContent = `+ Create "${query}"`;
      button.addEventListener('click', () => {
        closeDropdown();
        opts.onCreateNew(query);
      });
      dropdownEl.appendChild(button);
    }

    if (dropdownEl.children.length > 0) {
      dropdownEl.classList.add('open');
      inputEl.setAttribute('aria-expanded', 'true');
    } else {
      closeDropdown();
    }
  }

  function closeDropdown() {
    dropdownEl.classList.remove('open');
    dropdownEl.innerHTML = '';
    inputEl.setAttribute('aria-expanded', 'false');
  }
}

/**
 * attachStoreAutocomplete(inputEl, dropdownEl, opts)
 */
function attachStoreAutocomplete(inputEl, dropdownEl, opts = {}) {
  let allStores = [];
  let loaded = false;
  if (!dropdownEl.id) dropdownEl.id = `store-options-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  inputEl.setAttribute('role', 'combobox');
  inputEl.setAttribute('aria-autocomplete', 'list');
  inputEl.setAttribute('aria-controls', dropdownEl.id);
  inputEl.setAttribute('aria-expanded', 'false');
  dropdownEl.setAttribute('role', 'listbox');

  async function loadStores() {
    if (loaded) return;
    allStores = await api.stores.list();
    loaded = true;
  }

  inputEl.addEventListener('focus', () => {
    loadStores();
  });

  inputEl.addEventListener('input', async () => {
    await loadStores();
    const val = inputEl.value.trim().toLowerCase();
    if (!val) { closeDropdown(); return; }
    const matches = allStores.filter(s => s.name.toLowerCase().includes(val));
    renderStoreDropdown(matches, inputEl.value.trim());
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => {
      if (!inputEl.closest('.autocomplete-wrap')?.contains(document.activeElement)) closeDropdown();
    }, 150);
  });
  inputEl.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      const firstOption = dropdownEl.querySelector('button');
      if (firstOption) { event.preventDefault(); firstOption.focus(); }
    } else if (event.key === 'Escape') {
      closeDropdown();
    }
  });

  function renderStoreDropdown(stores, query) {
    dropdownEl.innerHTML = '';
    stores.forEach(store => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'autocomplete-item';
      button.setAttribute('role', 'option');
      button.innerHTML = `<div class="autocomplete-item-name">${escapeHtml(store.name)}</div>
        ${store.location ? `<div class="autocomplete-item-meta">${escapeHtml(store.location)}</div>` : ''}`;
      button.addEventListener('click', () => {
        inputEl.value = store.name;
        closeDropdown();
        if (opts.onSelect) opts.onSelect(store);
      });
      dropdownEl.appendChild(button);
    });

    if (opts.onCreateNew && query) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'autocomplete-create';
      button.setAttribute('role', 'option');
      button.textContent = `+ Add store "${query}"`;
      button.addEventListener('click', () => {
        closeDropdown();
        opts.onCreateNew(query);
      });
      dropdownEl.appendChild(button);
    }

    if (dropdownEl.children.length > 0) {
      dropdownEl.classList.add('open');
      inputEl.setAttribute('aria-expanded', 'true');
    } else {
      closeDropdown();
    }
  }

  function closeDropdown() {
    dropdownEl.classList.remove('open');
    dropdownEl.innerHTML = '';
    inputEl.setAttribute('aria-expanded', 'false');
  }

  // Expose reload for when a new store is added
  return { reload: () => { loaded = false; } };
}

// Reusable inline catalog-item fields for parent forms that must preserve state.
function inlineItemCreationFields(prefix) {
  return `
    <input type="hidden" id="${prefix}-new-item-mode" value="false" />
    <div id="${prefix}-new-item-fields" class="callout-box inline-item-create" style="display:none">
      <div class="inline-item-create-title">New item details</div>
      <div class="form-group">
        <label for="${prefix}-new-brand">Brand <span class="text-muted text-sm">(optional)</span></label>
        <input class="form-control" id="${prefix}-new-brand" placeholder="e.g. Kirkland" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="${prefix}-new-category">Category</label>
          <input class="form-control" id="${prefix}-new-category" placeholder="e.g. Dairy"
            list="${prefix}-category-list" />
          <datalist id="${prefix}-category-list">
            <option value="Produce"/><option value="Dairy"/><option value="Meat &amp; Seafood"/>
            <option value="Bakery"/><option value="Pantry"/><option value="Frozen"/>
            <option value="Beverages"/><option value="Snacks"/>
            <option value="Condiments &amp; Sauces"/><option value="Cleaning &amp; Household"/>
          </datalist>
        </div>
        <div class="form-group">
          <label for="${prefix}-new-unit">Unit</label>
          <input class="form-control" id="${prefix}-new-unit" placeholder="e.g. lb, each"
            list="${prefix}-unit-list" />
          <datalist id="${prefix}-unit-list">
            <option value="lb"/><option value="oz"/><option value="each"/><option value="fl oz"/>
            <option value="gal"/><option value="dozen"/><option value="pack"/><option value="count"/>
            <option value="loaf"/><option value="bunch"/><option value="pint"/><option value="roll"/>
          </datalist>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="${prefix}-new-size">Size <span class="text-muted text-sm">(optional)</span></label>
          <input class="form-control" type="number" id="${prefix}-new-size" step="any" min="0" placeholder="e.g. 28" />
        </div>
        <label class="checkbox-row inline-organic-option" for="${prefix}-new-organic">
          <input type="checkbox" id="${prefix}-new-organic" />
          <span>Organic</span>
        </label>
      </div>
    </div>`;
}

function startInlineItemCreation(prefix, name, inputId, hiddenItemId) {
  document.getElementById(inputId).value = name;
  document.getElementById(hiddenItemId).value = '';
  document.getElementById(`${prefix}-new-item-mode`).value = 'true';
  document.getElementById(`${prefix}-new-item-fields`).style.display = '';
  document.getElementById(`${prefix}-new-category`)?.focus();
}

function clearInlineItemCreation(prefix) {
  const mode = document.getElementById(`${prefix}-new-item-mode`);
  const fields = document.getElementById(`${prefix}-new-item-fields`);
  if (mode) mode.value = 'false';
  if (fields) fields.style.display = 'none';
}

function readInlineItemCreation(prefix, name) {
  if (document.getElementById(`${prefix}-new-item-mode`)?.value !== 'true') return null;
  const category = document.getElementById(`${prefix}-new-category`).value.trim();
  const unit = document.getElementById(`${prefix}-new-unit`).value.trim();
  if (!String(name || '').trim() || !category || !unit) {
    throw new Error('Name, category, and unit are required for a new item');
  }
  const sizeRaw = document.getElementById(`${prefix}-new-size`).value;
  const size = sizeRaw === '' ? null : Number(sizeRaw);
  if (size !== null && (!Number.isFinite(size) || size <= 0)) throw new Error('Size must be greater than zero');
  return {
    name: String(name).trim(),
    brand: document.getElementById(`${prefix}-new-brand`).value.trim(),
    category,
    unit,
    size,
    isOrganic: document.getElementById(`${prefix}-new-organic`).checked,
    isSeeded: false
  };
}

// Separate modal retained for direct Catalog creation.
async function promptCreateItem(name, onCreated) {
  const bodyHTML = `
    <form id="new-item-form">
      <div class="form-group">
        <label>Item Name</label>
        <input class="form-control" name="name" value="${escapeAttr(name || '')}" required placeholder="e.g. Large Eggs" />
      </div>
      <div class="form-group">
        <label>Brand <span class="text-muted text-sm">(optional)</span></label>
        <input class="form-control" name="brand" placeholder="e.g. Great Value, Kirkland" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Category</label>
          <input class="form-control" name="category" required placeholder="e.g. Dairy" list="category-list" />
          <datalist id="category-list">
            <option value="Produce"/><option value="Dairy"/><option value="Meat &amp; Seafood"/>
            <option value="Bakery"/><option value="Pantry"/><option value="Frozen"/>
            <option value="Beverages"/><option value="Snacks"/>
            <option value="Condiments &amp; Sauces"/><option value="Cleaning &amp; Household"/>
          </datalist>
        </div>
        <div class="form-group">
          <label>Unit</label>
          <input class="form-control" name="unit" required placeholder="e.g. lb, oz, each" list="unit-list" />
          <datalist id="unit-list">
            <option value="lb"/><option value="oz"/><option value="each"/>
            <option value="fl oz"/><option value="gal"/><option value="dozen"/>
            <option value="pack"/><option value="count"/><option value="loaf"/>
            <option value="bunch"/><option value="pint"/><option value="roll"/>
          </datalist>
        </div>
      </div>
      <div class="form-group">
        <label>Size <span class="text-muted text-sm">(optional)</span></label>
        <input class="form-control" type="number" name="size" step="any" min="0" placeholder="e.g. 28 (for 28 oz)" />
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:0.5rem">
        <input type="checkbox" name="isOrganic" id="new-item-organic" />
        <label for="new-item-organic" style="margin:0;font-weight:500">Organic product</label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create Item</button>
      </div>
    </form>`;

  openModal('New Item', bodyHTML);

  document.getElementById('new-item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const sizeVal = parseFloat(form.size.value);
    const data = {
      name: form.name.value.trim(),
      brand: form.brand.value.trim(),
      category: form.category.value.trim(),
      unit: form.unit.value.trim(),
      size: !isNaN(sizeVal) && sizeVal > 0 ? sizeVal : null,
      isOrganic: form.isOrganic.checked,
      isSeeded: false
    };
    try {
      const item = await api.items.create(data);
      closeModal();
      if (onCreated) onCreated(item);
    } catch (err) {
      handleError(err, 'Failed to create item');
    }
  });
}

// Inline create store modal
async function promptCreateStore(name, onCreated) {
  const bodyHTML = `
    <form id="new-store-form">
      <div class="form-group">
        <label>Store Name</label>
        <input class="form-control" name="name" value="${escapeAttr(name || '')}" required placeholder="e.g. Trader Joe's" />
      </div>
      <div class="form-group">
        <label>Location (optional)</label>
        <input class="form-control" name="location" placeholder="e.g. Main St" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Store</button>
      </div>
    </form>`;

  openModal('New Store', bodyHTML);

  document.getElementById('new-store-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
      name: form.name.value.trim(),
      location: form.location.value.trim()
    };
    try {
      const store = await api.stores.create(data);
      closeModal();
      window.onWizardActionComplete?.('add-store');
      if (onCreated) onCreated(store);
    } catch (err) {
      handleError(err, 'Failed to add store');
    }
  });
}
