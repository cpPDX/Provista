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
        closeDropdown();
      }
    }, 200);
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(closeDropdown, 150);
  });

  function renderItemDropdown(items, query) {
    dropdownEl.innerHTML = '';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';
      div.innerHTML = `<div class="autocomplete-item-name">${item.name}</div>
        <div class="autocomplete-item-meta">${item.category} &middot; ${item.unit}</div>`;
      div.addEventListener('mousedown', () => {
        inputEl.value = item.name;
        closeDropdown();
        if (opts.onSelect) opts.onSelect(item);
      });
      dropdownEl.appendChild(div);
    });

    // "Create new" option
    if (opts.onCreateNew) {
      const div = document.createElement('div');
      div.className = 'autocomplete-create';
      div.textContent = `+ Create "${query}"`;
      div.addEventListener('mousedown', () => {
        closeDropdown();
        opts.onCreateNew(query);
      });
      dropdownEl.appendChild(div);
    }

    if (dropdownEl.children.length > 0) {
      dropdownEl.classList.add('open');
    } else {
      closeDropdown();
    }
  }

  function closeDropdown() {
    dropdownEl.classList.remove('open');
    dropdownEl.innerHTML = '';
  }
}

/**
 * attachStoreAutocomplete(inputEl, dropdownEl, opts)
 */
function attachStoreAutocomplete(inputEl, dropdownEl, opts = {}) {
  let allStores = [];
  let loaded = false;

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
    setTimeout(closeDropdown, 150);
  });

  function renderStoreDropdown(stores, query) {
    dropdownEl.innerHTML = '';
    stores.forEach(store => {
      const div = document.createElement('div');
      div.className = 'autocomplete-item';
      div.innerHTML = `<div class="autocomplete-item-name">${store.name}</div>
        ${store.location ? `<div class="autocomplete-item-meta">${store.location}</div>` : ''}`;
      div.addEventListener('mousedown', () => {
        inputEl.value = store.name;
        closeDropdown();
        if (opts.onSelect) opts.onSelect(store);
      });
      dropdownEl.appendChild(div);
    });

    if (opts.onCreateNew && query) {
      const div = document.createElement('div');
      div.className = 'autocomplete-create';
      div.textContent = `+ Add store "${query}"`;
      div.addEventListener('mousedown', () => {
        closeDropdown();
        opts.onCreateNew(query);
      });
      dropdownEl.appendChild(div);
    }

    if (dropdownEl.children.length > 0) {
      dropdownEl.classList.add('open');
    } else {
      closeDropdown();
    }
  }

  function closeDropdown() {
    dropdownEl.classList.remove('open');
    dropdownEl.innerHTML = '';
  }

  // Expose reload for when a new store is added
  return { reload: () => { loaded = false; } };
}

// Inline create item modal
async function promptCreateItem(name, onCreated) {
  const bodyHTML = `
    <form id="new-item-form">
      <div class="form-group">
        <label>Item Name</label>
        <input class="form-control" name="name" value="${name || ''}" required placeholder="e.g. Large Eggs" />
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
    const data = {
      name: form.name.value.trim(),
      category: form.category.value.trim(),
      unit: form.unit.value.trim(),
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
        <input class="form-control" name="name" value="${name || ''}" required placeholder="e.g. Trader Joe's" />
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
