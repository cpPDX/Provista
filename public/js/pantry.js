// Pantry owns household stock state. Simple mode uses Have / Running low / Out.
// Exact mode uses quantity + an optional threshold and derives status automatically.
const Pantry = (() => {
  const state = { items: [], search: '' };
  const quantitySync = new Map();
  const statusSync = new Map();

  const statusLabels = { have: 'Have', low: 'Running low', out: 'Out' };

  function itemName(inv) {
    return inv?.itemId?.name || 'Item';
  }

  function unitFor(inv) {
    return inv?.unit || inv?.itemId?.unit || '';
  }

  function exactStatus(inv, quantity = Number(inv?.quantity) || 0) {
    if (quantity <= 0) return 'out';
    const threshold = inv?.lowStockThreshold;
    if (threshold !== null && threshold !== undefined && Number.isFinite(Number(threshold)) && quantity <= Number(threshold)) return 'low';
    return 'have';
  }

  function normalizedMode(inv) {
    return inv?.trackingMode === 'exact' || inv?.lowStockThreshold != null ? 'exact' : 'simple';
  }

  function metadata(inv) {
    return inv.itemId ? formatItemMeta(inv.itemId) : escapeHtml(inv.itemId?.category || '');
  }

  function exactSummary(inv) {
    const quantity = Number(inv.quantity) || 0;
    const unit = unitFor(inv);
    const threshold = inv.lowStockThreshold;
    const quantityText = `${quantity}${unit ? ` ${unit}` : ''} left`;
    if (threshold === null || threshold === undefined) return quantityText;
    return `${quantityText} · Provista marks low at ${threshold}${unit ? ` ${unit}` : ''}`;
  }

  function cardMarkup(inv) {
    const mode = normalizedMode(inv);
    const status = mode === 'exact' ? exactStatus(inv) : (inv.stockStatus || 'have');
    const name = itemName(inv);
    const unit = unitFor(inv);
    return `
      <div class="card pantry-card pantry-${status}" data-inv-id="${escapeAttr(inv._id)}" data-tracking-mode="${mode}">
        <div class="card-body">
          <div class="card-title">
            ${escapeHtml(name)}
            <span class="badge pantry-status-badge">${escapeHtml(statusLabels[status])}</span>
          </div>
          ${metadata(inv) ? `<div class="card-subtitle">${metadata(inv)}</div>` : ''}
          ${inv.notes ? `<div class="text-muted text-sm">${escapeHtml(inv.notes)}</div>` : ''}

          ${mode === 'simple' ? `
            <p class="pantry-mode-help">Running low and Out items appear on Home and can be added to your shopping list.</p>
            <div class="pantry-status-actions" role="group" aria-label="Stock status for ${escapeAttr(name)}">
              ${['have', 'low', 'out'].map(value => `
                <button type="button" class="pantry-status-option${status === value ? ' active' : ''}"
                  data-stock-status="${value}" onclick="Pantry.setStatus('${escapeAttr(inv._id)}', '${value}')" aria-pressed="${status === value}">
                  ${statusLabels[value]}
                </button>`).join('')}
            </div>
            <button type="button" class="btn-link pantry-mode-switch" onclick="Pantry.openEdit('${escapeAttr(inv._id)}', 'exact')">Track an exact quantity instead</button>
          ` : `
            <p class="pantry-mode-help">${escapeHtml(exactSummary(inv))}</p>
            <div class="qty-controls pantry-qty-controls" aria-label="Exact quantity for ${escapeAttr(name)}">
              <button type="button" class="qty-btn" onclick="Pantry.adjustQuantity('${escapeAttr(inv._id)}', -1)" aria-label="Decrease ${escapeAttr(name)} quantity">−</button>
              <span class="qty-val" aria-live="polite">${escapeHtml(inv.quantity)}</span>
              <button type="button" class="qty-btn" onclick="Pantry.adjustQuantity('${escapeAttr(inv._id)}', 1)" aria-label="Increase ${escapeAttr(name)} quantity">+</button>
              <button type="button" class="btn btn-outline btn-sm" onclick="Pantry.openEdit('${escapeAttr(inv._id)}')">Edit details</button>
              ${window.appAuth?.isAdmin() ? `<button type="button" class="btn btn-danger btn-sm" onclick="Pantry.remove('${escapeAttr(inv._id)}')">Remove</button>` : ''}
            </div>
          `}
          ${mode === 'simple' ? `
            <div class="pantry-secondary-actions">
              <button type="button" class="btn btn-outline btn-sm" onclick="Pantry.openEdit('${escapeAttr(inv._id)}')">Edit details</button>
              ${window.appAuth?.isAdmin() ? `<button type="button" class="btn btn-danger btn-sm" onclick="Pantry.remove('${escapeAttr(inv._id)}')">Remove</button>` : ''}
            </div>` : ''}
        </div>
      </div>`;
  }

  function visibleItems() {
    const query = state.search.trim().toLowerCase();
    if (!query) return state.items;
    return state.items.filter(inv => [inv.itemId?.name, inv.itemId?.brand, inv.itemId?.category, inv.notes]
      .some(value => String(value || '').toLowerCase().includes(query)));
  }

  function render() {
    const container = document.getElementById('inventory-list');
    if (!container) return;
    const items = visibleItems();
    if (!items.length) {
      container.innerHTML = emptyState('🧺', state.search ? 'No Pantry items match that search.' : 'No Pantry items yet.');
      return;
    }
    // Preserve the server-provided priority order while the user is on the screen.
    // Status changes patch cards in place; a fresh load re-sorts for the next visit.
    container.innerHTML = items.map(cardMarkup).join('');
  }

  function patchCard(inv) {
    const card = document.querySelector(`.pantry-card[data-inv-id="${CSS.escape(inv._id)}"]`);
    if (!card) return;
    const mode = normalizedMode(inv);
    const status = mode === 'exact' ? exactStatus(inv) : (inv.stockStatus || 'have');
    card.classList.remove('pantry-have', 'pantry-low', 'pantry-out');
    card.classList.add(`pantry-${status}`);
    card.dataset.trackingMode = mode;
    const badge = card.querySelector('.pantry-status-badge');
    if (badge) badge.textContent = statusLabels[status];
    const qty = card.querySelector('.qty-val');
    if (qty) qty.textContent = String(inv.quantity);
    const help = card.querySelector('.pantry-mode-help');
    if (help && mode === 'exact') help.textContent = exactSummary(inv);
    card.querySelectorAll('.pantry-status-option').forEach(button => {
      const active = button.dataset.stockStatus === status;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  async function load() {
    try {
      state.items = await api.inventory.list();
      render();
    } catch (err) {
      handleError(err, 'Failed to load Pantry');
    }
  }

  function setSearch(value) {
    state.search = String(value || '');
    render();
  }

  function setStatus(id, stockStatus) {
    const item = state.items.find(entry => entry._id === id);
    if (!item || normalizedMode(item) !== 'simple' || item.stockStatus === stockStatus) return;

    let sync = statusSync.get(id);
    if (!sync) {
      sync = { serverStatus: item.stockStatus || 'have', desiredStatus: item.stockStatus || 'have', processing: false, promise: null };
      statusSync.set(id, sync);
    }
    sync.desiredStatus = stockStatus;
    item.stockStatus = stockStatus;
    item.quantity = stockStatus === 'out' ? 0 : Math.max(Number(item.quantity) || 1, 1);
    patchCard(item);
    document.querySelector(`.pantry-card[data-inv-id="${CSS.escape(id)}"] [data-stock-status="${stockStatus}"]`)?.focus({ preventScroll: true });
    if (!sync.processing) sync.promise = persistStatus(id);
  }

  async function persistStatus(id) {
    const sync = statusSync.get(id);
    const item = state.items.find(entry => entry._id === id);
    if (!sync || !item || sync.processing) return true;
    sync.processing = true;
    try {
      while (sync.serverStatus !== sync.desiredStatus) {
        const target = sync.desiredStatus;
        const updated = await api.inventory.update(id, { trackingMode: 'simple', stockStatus: target });
        sync.serverStatus = target;
        if (sync.desiredStatus === target) Object.assign(item, updated);
      }
      item.stockStatus = sync.desiredStatus;
      patchCard(item);
      statusSync.delete(id);
      showToast(`${itemName(item)} marked ${statusLabels[item.stockStatus].toLowerCase()}`);
      return true;
    } catch (err) {
      item.stockStatus = sync.serverStatus;
      item.quantity = item.stockStatus === 'out' ? 0 : Math.max(Number(item.quantity) || 1, 1);
      patchCard(item);
      statusSync.delete(id);
      handleError(err, 'Failed to update Pantry status');
      return false;
    } finally {
      sync.processing = false;
    }
  }

  function adjustQuantity(id, delta) {
    const item = state.items.find(entry => entry._id === id);
    if (!item || normalizedMode(item) !== 'exact') return;
    const next = Math.max(0, (Number(item.quantity) || 0) + Number(delta || 0));

    let sync = quantitySync.get(id);
    if (!sync) {
      sync = { serverQuantity: Number(item.quantity) || 0, desiredQuantity: Number(item.quantity) || 0, processing: false, promise: null };
      quantitySync.set(id, sync);
    }
    sync.desiredQuantity = next;
    item.quantity = next;
    item.stockStatus = exactStatus(item, next);
    patchCard(item);
    const focusSelector = delta >= 0
      ? `[aria-label="Increase ${CSS.escape(itemName(item))} quantity"]`
      : `[aria-label="Decrease ${CSS.escape(itemName(item))} quantity"]`;
    document.querySelector(`.pantry-card[data-inv-id="${CSS.escape(id)}"] ${focusSelector}`)?.focus({ preventScroll: true });
    if (!sync.processing) sync.promise = persistQuantity(id);
  }

  async function persistQuantity(id) {
    const sync = quantitySync.get(id);
    const item = state.items.find(entry => entry._id === id);
    if (!sync || !item || sync.processing) return true;
    sync.processing = true;
    let lastResponse = null;
    try {
      while (sync.serverQuantity !== sync.desiredQuantity) {
        const target = sync.desiredQuantity;
        lastResponse = await api.inventory.update(id, { trackingMode: 'exact', quantity: target });
        sync.serverQuantity = target;
      }
      if (lastResponse) Object.assign(item, lastResponse);
      item.quantity = sync.desiredQuantity;
      item.stockStatus = exactStatus(item);
      patchCard(item);
      quantitySync.delete(id);
      return true;
    } catch (err) {
      item.quantity = sync.serverQuantity;
      item.stockStatus = exactStatus(item);
      patchCard(item);
      quantitySync.delete(id);
      handleError(err, 'Failed to update Pantry quantity');
      return false;
    } finally {
      sync.processing = false;
    }
  }

  function trackingFields(prefix, mode, quantity, threshold, status) {
    return `
      <fieldset class="pantry-tracking-choice">
        <legend>How should Provista track this?</legend>
        <label class="pantry-tracking-option">
          <input type="radio" name="${prefix}-tracking-mode" value="simple" ${mode === 'simple' ? 'checked' : ''} />
          <span><strong>Simple</strong><small>I’ll mark it Have, Running low, or Out.</small></span>
        </label>
        <label class="pantry-tracking-option">
          <input type="radio" name="${prefix}-tracking-mode" value="exact" ${mode === 'exact' ? 'checked' : ''} />
          <span><strong>Exact quantity</strong><small>I’ll track a number and Provista can mark it low automatically.</small></span>
        </label>
      </fieldset>
      <div id="${prefix}-simple-fields" ${mode === 'simple' ? '' : 'hidden'}>
        <div class="form-group">
          <label for="${prefix}-status">What do you have right now?</label>
          <select class="form-control" id="${prefix}-status">
            <option value="have" ${status === 'have' ? 'selected' : ''}>Have</option>
            <option value="low" ${status === 'low' ? 'selected' : ''}>Running low</option>
            <option value="out" ${status === 'out' ? 'selected' : ''}>Out</option>
          </select>
        </div>
      </div>
      <div id="${prefix}-exact-fields" ${mode === 'exact' ? '' : 'hidden'}>
        <p class="text-muted text-sm">Track a number if you want Provista to mark this item low automatically.</p>
        <div class="form-group">
          <label for="${prefix}-qty">How many are left?</label>
          <input class="form-control" type="number" id="${prefix}-qty" value="${escapeAttr(quantity)}" min="0" step="any" />
        </div>
        <div class="form-group">
          <label for="${prefix}-threshold">Mark Running low at or below <span class="text-muted text-sm">(optional)</span></label>
          <input class="form-control" type="number" id="${prefix}-threshold" value="${escapeAttr(threshold ?? '')}" placeholder="e.g. 2" min="0" step="any" />
        </div>
      </div>`;
  }

  function bindTrackingMode(prefix) {
    const radios = document.querySelectorAll(`input[name="${prefix}-tracking-mode"]`);
    const sync = () => {
      const mode = document.querySelector(`input[name="${prefix}-tracking-mode"]:checked`)?.value || 'simple';
      document.getElementById(`${prefix}-simple-fields`).hidden = mode !== 'simple';
      document.getElementById(`${prefix}-exact-fields`).hidden = mode !== 'exact';
    };
    radios.forEach(radio => radio.addEventListener('change', sync));
    sync();
  }

  function readTracking(prefix) {
    const trackingMode = document.querySelector(`input[name="${prefix}-tracking-mode"]:checked`)?.value || 'simple';
    if (trackingMode === 'simple') {
      return {
        trackingMode,
        stockStatus: document.getElementById(`${prefix}-status`).value,
        lowStockThreshold: null
      };
    }
    const quantity = Number(document.getElementById(`${prefix}-qty`).value);
    const thresholdRaw = document.getElementById(`${prefix}-threshold`).value.trim();
    const lowStockThreshold = thresholdRaw === '' ? null : Number(thresholdRaw);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Enter a valid quantity');
    if (lowStockThreshold !== null && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) {
      throw new Error('Enter a valid low-stock number');
    }
    return { trackingMode, quantity, lowStockThreshold };
  }

  function openAdd() {
    const bodyHTML = `
      <form id="add-inv-form">
        <div class="form-group">
          <label for="inv-item-input">What do you want to track?</label>
          <div class="autocomplete-wrap">
            <input class="form-control" id="inv-item-input" placeholder="Search or create item…" autocomplete="off" required />
            <div class="autocomplete-dropdown" id="inv-item-dropdown"></div>
          </div>
          <input type="hidden" id="inv-item-id" />
          <input type="hidden" id="inv-item-unit" />
        </div>
        ${inlineItemCreationFields('inv')}
        ${trackingFields('inv', 'simple', 1, null, 'have')}
        <div class="form-group">
          <label for="inv-notes">Notes <span class="text-muted text-sm">(optional)</span></label>
          <input class="form-control" id="inv-notes" placeholder="e.g. expires Friday" />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Track item</button>
        </div>
      </form>`;
    openModal('Track an item', bodyHTML);
    bindTrackingMode('inv');

    const itemInput = document.getElementById('inv-item-input');
    let selectedItemName = '';
    attachItemAutocomplete(itemInput, document.getElementById('inv-item-dropdown'), {
      onSelect(item) {
        selectedItemName = item.name;
        document.getElementById('inv-item-id').value = item._id;
        document.getElementById('inv-item-unit').value = item.unit || '';
        clearInlineItemCreation('inv');
      },
      onCreateNew: name => {
        selectedItemName = '';
        startInlineItemCreation('inv', name, 'inv-item-input', 'inv-item-id');
      }
    });
    itemInput.addEventListener('input', () => {
      if (document.getElementById('inv-new-item-mode')?.value === 'true') return;
      if (selectedItemName && itemInput.value !== selectedItemName) document.getElementById('inv-item-id').value = '';
    });

    document.getElementById('add-inv-form').addEventListener('submit', async event => {
      event.preventDefault();
      let itemId = document.getElementById('inv-item-id').value;
      const submit = formSubmitButton(event.target);
      submit.disabled = true;
      submit.textContent = 'Adding…';
      try {
        if (!itemId) {
          const newItem = readInlineItemCreation('inv', itemInput.value);
          if (!newItem) throw new Error('Select an item or choose Create');
          const created = await api.items.create(newItem);
          itemId = created._id;
          document.getElementById('inv-item-unit').value = created.unit || '';
        }
        const tracking = readTracking('inv');
        await api.inventory.save({
          itemId,
          ...tracking,
          unit: document.getElementById('inv-item-unit').value,
          notes: document.getElementById('inv-notes').value.trim()
        });
        closeModal();
        showToast('Item is now tracked in Pantry');
        await load();
      } catch (err) {
        handleError(err, 'Failed to add to Pantry');
        submit.disabled = false;
        submit.textContent = 'Track item';
      }
    });
  }

  function openEdit(id, requestedMode = null) {
    const inv = state.items.find(entry => entry._id === id);
    if (!inv) return;
    const mode = requestedMode || normalizedMode(inv);
    const bodyHTML = `
      <form id="edit-inv-form">
        ${trackingFields('edit-inv', mode, inv.quantity, inv.lowStockThreshold, inv.stockStatus || 'have')}
        <div class="form-group">
          <label for="edit-inv-notes">Notes <span class="text-muted text-sm">(optional)</span></label>
          <input class="form-control" id="edit-inv-notes" value="${escapeAttr(inv.notes || '')}" placeholder="e.g. expires Friday" />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save tracking</button>
        </div>
      </form>`;
    openModal(`Track ${itemName(inv)}`, bodyHTML);
    bindTrackingMode('edit-inv');
    registerDirtyForm(() => document.getElementById('edit-inv-form')?.requestSubmit());

    document.getElementById('edit-inv-form').addEventListener('submit', async event => {
      event.preventDefault();
      const submit = formSubmitButton(event.target);
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        const tracking = readTracking('edit-inv');
        const updated = await api.inventory.update(id, {
          ...tracking,
          notes: document.getElementById('edit-inv-notes').value.trim()
        });
        Object.assign(inv, updated);
        closeModal();
        // Mode changes can legitimately alter the card layout, so replace only
        // this card rather than re-rendering/re-sorting the whole Pantry.
        const card = document.querySelector(`.pantry-card[data-inv-id="${CSS.escape(id)}"]`);
        if (card) {
          const template = document.createElement('template');
          template.innerHTML = cardMarkup(inv).trim();
          card.replaceWith(template.content.firstElementChild);
        } else {
          render();
        }
        showToast('Pantry tracking updated');
      } catch (err) {
        handleError(err, 'Failed to update Pantry');
        submit.disabled = false;
        submit.textContent = 'Save tracking';
      }
    });
  }

  async function remove(id) {
    const item = state.items.find(entry => entry._id === id);
    const name = itemName(item);
    const confirmed = await confirmAction({
      title: 'Remove from Pantry?',
      message: `${name} will stop appearing in Pantry and low-stock reminders. This does not remove the product from your household catalog.`,
      confirmLabel: 'Remove from Pantry'
    });
    if (!confirmed) return;
    try {
      await api.inventory.delete(id);
      state.items = state.items.filter(entry => entry._id !== id);
      document.querySelector(`.pantry-card[data-inv-id="${CSS.escape(id)}"]`)?.remove();
      if (!visibleItems().length) render();
      showToast(`${name} removed from Pantry`);
    } catch (err) {
      handleError(err, 'Failed to remove item');
    }
  }

  return {
    state,
    load,
    render,
    setSearch,
    setStatus,
    adjustQuantity,
    openAdd,
    openEdit,
    remove
  };
})();

window.Pantry = Pantry;
