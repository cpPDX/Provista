// Parent-first usability layer for shopping and deferred price review.
// Loaded after the core tab scripts so it can refine existing behavior without
// coupling external pricing or deferred review into the base CRUD modules.
(function initParentExperienceLayer() {
  const externalPricesByItemId = new Map();
  let externalRefreshPromise = null;
  let deferredPriceItems = [];

  function itemObjectId(item) {
    return String(item?.itemId?._id || item?.itemId || '');
  }

  function entryStoreId(item, entry) {
    return String(item?.storeId?._id || item?.storeId || item?.tripStore?._id || entry?.storeId || '');
  }

  function ensurePriceDecision(item, entry) {
    if (!entry) return;
    const currentStoreId = entryStoreId(item, entry);

    // Keep an automatically selected historical price aligned with the current
    // store. Explicit user choices (updated/later) are never silently changed.
    if (!entry.priceDecision || entry.priceDecision === 'existing') {
      const known = currentStoreId ? knownLinePriceForStore(entry, currentStoreId) : entry.suggestedPrice;
      entry.storeId = currentStoreId || entry.storeId || null;
      entry.suggestedPrice = known;
      if (known !== null) {
        entry.price = known;
        entry.needsPrice = false;
        entry.priceDecision = 'existing';
      } else {
        entry.price = null;
        entry.needsPrice = true;
        entry.priceDecision = 'later';
      }
    }
  }

  function decisionCopy(entry) {
    if (entry.priceDecision === 'updated') return `Using updated price ${formatCurrency(entry.price)}`;
    if (entry.priceDecision === 'later') return 'Price will be reviewed later';
    if (entry.suggestedPrice !== null && entry.suggestedPrice !== undefined) {
      return `Using recent price ${formatCurrency(entry.suggestedPrice)}`;
    }
    return 'No recent price available';
  }

  function setDecision(itemId, decision) {
    const item = listState.items.find(candidate => candidate._id === itemId);
    const entry = cartState.get(itemId);
    if (!item || !entry) return;

    if (decision === 'existing') {
      const storeId = entryStoreId(item, entry);
      const known = storeId ? knownLinePriceForStore(entry, storeId) : entry.suggestedPrice;
      if (known === null || known === undefined) {
        showToast('No recent price is available for this store. Choose Update price or Later.');
        return;
      }
      entry.suggestedPrice = known;
      entry.price = known;
      entry.needsPrice = false;
      entry.priceDecision = 'existing';
      renderShoppingList();
      return;
    }

    if (decision === 'later') {
      entry.price = null;
      entry.needsPrice = true;
      entry.priceDecision = 'later';
      renderShoppingList();
      return;
    }

    if (decision === 'update') openInlinePriceEditor(item, entry);
  }

  function openInlinePriceEditor(item, entry) {
    const name = item.itemId?.name || entry.name || 'Item';
    const current = entry.price ?? entry.suggestedPrice;
    openModal('Update price', `
      <form id="inline-price-form">
        <p class="text-muted text-sm">Enter what you paid for <strong>${escapeHtml(name)}</strong>. You can keep shopping immediately after saving.</p>
        <div class="form-group">
          <label for="inline-price-value">Price paid</label>
          <input class="form-control" id="inline-price-value" type="number" inputmode="decimal"
            min="0" step="0.01" required value="${current === null || current === undefined ? '' : escapeAttr(Number(current).toFixed(2))}" />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Use this price</button>
        </div>
      </form>`);

    const input = document.getElementById('inline-price-value');
    setTimeout(() => input?.select(), 0);
    document.getElementById('inline-price-form')?.addEventListener('submit', event => {
      event.preventDefault();
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < 0) return showToast('Enter a valid price');
      entry.price = Math.round((value + Number.EPSILON) * 100) / 100;
      entry.needsPrice = false;
      entry.priceDecision = 'updated';
      closeModal();
      renderShoppingList();
    });
  }

  function appendPriceDecisionControls() {
    listState.items.filter(item => item.checked).forEach(item => {
      const card = document.querySelector(`.list-item[data-id="${CSS.escape(item._id)}"]`);
      const body = card?.querySelector('.card-body');
      const entry = cartState.get(item._id);
      if (!body || !entry) return;

      ensurePriceDecision(item, entry);
      const controls = document.createElement('div');
      controls.className = 'purchase-price-choice';
      controls.innerHTML = `
        <div class="purchase-price-choice-status">${escapeHtml(decisionCopy(entry))}</div>
        <div class="purchase-price-choice-actions" role="group" aria-label="Price choice for ${escapeAttr(entry.name)}">
          ${entry.suggestedPrice !== null && entry.suggestedPrice !== undefined
            ? `<button type="button" class="price-choice-btn ${entry.priceDecision === 'existing' ? 'selected' : ''}" data-price-choice="existing">Use ${escapeHtml(formatCurrency(entry.suggestedPrice))}</button>`
            : ''}
          <button type="button" class="price-choice-btn ${entry.priceDecision === 'updated' ? 'selected' : ''}" data-price-choice="update">Update price</button>
          <button type="button" class="price-choice-btn ${entry.priceDecision === 'later' ? 'selected' : ''}" data-price-choice="later">Later</button>
        </div>`;
      controls.querySelectorAll('[data-price-choice]').forEach(button => {
        button.addEventListener('click', event => {
          event.stopPropagation();
          setDecision(item._id, button.dataset.priceChoice);
        });
      });
      body.appendChild(controls);
    });
  }

  function appendExternalPriceSignals() {
    listState.items.filter(item => !item.checked).forEach(item => {
      const signal = externalPricesByItemId.get(itemObjectId(item));
      if (!signal?.observation) return;
      const body = document.querySelector(`.list-item[data-id="${CSS.escape(item._id)}"] .card-body`);
      if (!body) return;
      const observation = signal.observation;
      const age = typeof formatPriceAge === 'function'
        ? formatPriceAge(observation.observedAt, true)
        : new Date(observation.observedAt).toLocaleDateString();
      const note = document.createElement('div');
      note.className = 'external-price-signal';
      note.innerHTML = `<strong>Open Prices:</strong> ${escapeHtml(formatCurrency(observation.price))} at ${escapeHtml(signal.storeName || 'this store')} · ${escapeHtml(age)}
        <span>Community-observed price</span>`;
      body.appendChild(note);
    });
  }

  async function refreshExternalShoppingPrices() {
    if (externalRefreshPromise || !navigator.onLine) return externalRefreshPromise;
    externalRefreshPromise = api.externalPrices.refreshShoppingList()
      .then(result => {
        externalPricesByItemId.clear();
        (result.observations || []).forEach(signal => externalPricesByItemId.set(String(signal.itemId), signal));
        if (document.getElementById('tab-list')?.classList.contains('active')) renderShoppingList();
      })
      .catch(err => console.info('External price refresh unavailable:', err.message))
      .finally(() => { externalRefreshPromise = null; });
    return externalRefreshPromise;
  }

  function applyOutcomeLabels() {
    const labels = [
      ['btn-add-list-item', '+ Add to list'],
      ['btn-scan-list-item', 'Scan item'],
      ['btn-clear-all', 'Empty list'],
      ['btn-add-inventory', '+ Track item'],
      ['btn-add-price', '+ Record price'],
      ['btn-done-shopping', 'Finish shopping']
    ];
    labels.forEach(([id, text]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = text;
    });

    const pricesHeading = document.querySelector('#tab-prices .page-header h1');
    if (pricesHeading) pricesHeading.textContent = 'Price history';
    const catalogLabel = document.querySelector('[data-section="items"] span:nth-child(2)');
    if (catalogLabel) catalogLabel.textContent = 'Manage products';
  }

  // Hide explanatory machinery unless Provista has an actionable savings signal.
  renderStoreSummary = function parentFirstStoreSummary(items) {
    const container = document.getElementById('list-summary');
    if (!container) return;
    const context = items.find(item => item.priceContext)?.priceContext;
    const savings = Number(context?.estimatedAdditionalStopSavings || 0);
    const threshold = Number(context?.savingsThreshold || 0);
    const additionalName = context?.additionalStore?.name;
    if (!additionalName || savings < threshold) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <div class="store-summary-recommendation parent-trip-suggestion">
        <strong>Worth another stop?</strong>
        ${escapeHtml(additionalName)} saves about <strong>${escapeHtml(formatCurrency(savings))}</strong> across this list.
      </div>`;
  };

  const baseRenderShoppingList = renderShoppingList;
  renderShoppingList = function parentFirstRenderShoppingList() {
    baseRenderShoppingList();
    appendPriceDecisionControls();
    appendExternalPriceSignals();
    applyOutcomeLabels();
  };

  const baseUpdateCartBar = updateCartBar;
  updateCartBar = function parentFirstUpdateCartBar() {
    baseUpdateCartBar();
    const label = document.getElementById('cart-bar-label');
    if (!label || cartState.size === 0) return;
    let total = 0;
    let later = 0;
    cartState.forEach(entry => {
      if (entry.price !== null && Number.isFinite(Number(entry.price))) total += Number(entry.price);
      else later++;
    });
    label.textContent = `${cartState.size} bought · ${formatCurrency(total)} recorded${later ? ` · ${later} to review` : ''}`;
  };

  renderCartDetail = function parentFirstCartDetail(container) {
    let total = 0;
    const rows = [];
    cartState.forEach(entry => {
      if (entry.price !== null && Number.isFinite(Number(entry.price))) total += Number(entry.price);
      rows.push(`<div class="cart-detail-row"><span>${escapeHtml(entry.name)}</span><span>${entry.price === null ? 'Review later' : escapeHtml(formatCurrency(entry.price))}</span></div>`);
    });
    rows.push(`<div class="cart-detail-row cart-detail-total"><span>Recorded so far</span><span>${escapeHtml(formatCurrency(total))}</span></div>`);
    container.innerHTML = rows.join('');
  };

  function selectedTripStoreId() {
    return document.getElementById('parent-trip-store')?.value || null;
  }

  function applyTripStore(storeId) {
    cartState.forEach(entry => {
      entry.storeId = storeId || null;
      if (entry.priceDecision !== 'existing') return;
      const known = storeId ? knownLinePriceForStore(entry, storeId) : null;
      entry.suggestedPrice = known;
      if (known === null) {
        entry.price = null;
        entry.needsPrice = true;
        entry.priceDecision = 'later';
      } else {
        entry.price = known;
        entry.needsPrice = false;
      }
    });
  }

  function renderFinishShoppingSummary() {
    const container = document.getElementById('parent-trip-price-summary');
    if (!container) return;
    let total = 0;
    const confirmed = [];
    const deferred = [];
    cartState.forEach(entry => {
      if (entry.price === null || !Number.isFinite(Number(entry.price))) deferred.push(entry);
      else {
        total += Number(entry.price);
        confirmed.push(entry);
      }
    });
    container.innerHTML = `
      <div class="finish-shopping-total"><strong>${cartState.size} item${cartState.size === 1 ? '' : 's'} purchased · ${escapeHtml(formatCurrency(total))} recorded</strong>
        ${deferred.length ? `<span>${deferred.length} price${deferred.length === 1 ? '' : 's'} will be reviewed later.</span>` : '<span>All prices are recorded.</span>'}
      </div>
      ${deferred.length ? `<div class="finish-shopping-deferred"><strong>Review later</strong>${deferred.map(entry => `<span>${escapeHtml(entry.name)}</span>`).join('')}</div>` : ''}
      ${confirmed.length ? `<details class="finish-shopping-confirmed"><summary>${confirmed.length} recorded price${confirmed.length === 1 ? '' : 's'}</summary>${confirmed.map(entry => `<div><span>${escapeHtml(entry.name)}</span><span>${escapeHtml(formatCurrency(entry.price))}</span></div>`).join('')}</details>` : ''}`;
  }

  openDoneShoppingReview = function parentFirstDoneShoppingReview() {
    const checkedItems = listState.items.filter(item => item.checked);
    if (!checkedItems.length) return showToast('No purchased items yet');
    checkedItems.forEach(item => {
      if (!cartState.has(item._id)) cartState.set(item._id, createCartEntry(item));
      ensurePriceDecision(item, cartState.get(item._id));
    });

    activeTripKey ||= typeof window.crypto?.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `trip-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const storeCounts = new Map();
    cartState.forEach(entry => {
      if (entry.storeId) storeCounts.set(String(entry.storeId), (storeCounts.get(String(entry.storeId)) || 0) + 1);
    });
    const initialStoreId = [...storeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const storeOptions = listState.stores.map(store => `<option value="${escapeAttr(store._id)}"${String(initialStoreId) === String(store._id) ? ' selected' : ''}>${escapeHtml(store.name)}</option>`).join('');
    applyTripStore(initialStoreId);

    openModal('Finish shopping', `
      <div class="finish-shopping-outcomes">
        <strong>Finishing will:</strong>
        <ul>
          <li>Add purchased items to Pantry</li>
          <li>Record the prices you confirmed</li>
          <li>Update Spending</li>
          <li>Remove purchased items from this list</li>
        </ul>
      </div>
      <div class="form-group">
        <label for="parent-trip-store">Where did you shop?</label>
        <select class="form-control" id="parent-trip-store">
          <option value="">Choose a store</option>
          ${storeOptions}
        </select>
      </div>
      <div id="parent-trip-price-summary"></div>
      <label class="trip-pantry-option">
        <input type="checkbox" id="parent-trip-add-to-pantry" checked />
        <span><strong>Update Pantry</strong><small>Purchased items become Have and tracked quantities are replenished.</small></span>
      </label>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Keep shopping</button>
        <button type="button" class="btn btn-primary" id="parent-finish-shopping">Finish shopping</button>
      </div>`);

    renderFinishShoppingSummary();
    document.getElementById('parent-trip-store')?.addEventListener('change', event => {
      applyTripStore(event.target.value || null);
      renderFinishShoppingSummary();
    });
    document.getElementById('parent-finish-shopping')?.addEventListener('click', finishParentShoppingTrip);
  };

  async function finishParentShoppingTrip() {
    const button = document.getElementById('parent-finish-shopping');
    const storeId = selectedTripStoreId();
    if (!storeId) {
      showToast('Choose where you shopped');
      document.getElementById('parent-trip-store')?.focus();
      return;
    }
    if (button) { button.disabled = true; button.textContent = 'Finishing…'; }

    if (!(await settlePendingCheckWrites())) {
      if (button) { button.disabled = false; button.textContent = 'Finish shopping'; }
      return showToast('One check-off could not be saved. Review the list and try again.');
    }

    const checkedItems = listState.items.filter(item => item.checked);
    const purchases = checkedItems.map(item => {
      const entry = cartState.get(item._id);
      const rawPrice = entry?.price;
      const price = rawPrice === null || rawPrice === undefined ? null : Number(rawPrice);
      return {
        listItemId: item._id,
        price: Number.isFinite(price) && price >= 0 ? price : null,
        storeId
      };
    });

    try {
      const result = await api.shoppingList.complete({
        idempotencyKey: activeTripKey,
        purchases,
        addToPantry: document.getElementById('parent-trip-add-to-pantry')?.checked !== false
      });
      checkedItems.forEach(item => cartState.delete(item._id));
      activeTripKey = null;
      closeModal();
      await loadShoppingListTab();
      await refreshDeferredPriceState();

      const parts = [`${result.itemCount} item${result.itemCount === 1 ? '' : 's'} finished`];
      if (result.pantryUpdated) parts.push('Pantry updated');
      if (result.missingPriceCount) parts.push(`${result.missingPriceCount} price${result.missingPriceCount === 1 ? '' : 's'} to review later`);
      else parts.push(`${formatCurrency(result.total)} added to Spending`);
      showToast(parts.join(' · '), 6000);
    } catch (err) {
      handleError(err, 'Could not finish shopping');
      if (button) { button.disabled = false; button.textContent = 'Finish shopping'; }
    }
  }

  function deferredCardMarkup() {
    if (!deferredPriceItems.length) return '';
    return `
      <article class="home-card home-price-review-card" id="home-price-review-card">
        <p class="home-question">Anything to finish?</p>
        <h2>${deferredPriceItems.length} price${deferredPriceItems.length === 1 ? '' : 's'} to review</h2>
        <p class="home-card-detail">Finish prices you chose to update later. Saving them updates Spending automatically.</p>
        <button class="home-card-action" id="home-review-prices">Review prices →</button>
      </article>`;
  }

  function renderDeferredHomeCard() {
    document.getElementById('home-price-review-card')?.remove();
    const container = document.getElementById('home-content');
    if (container && deferredPriceItems.length) {
      const template = document.createElement('template');
      template.innerHTML = deferredCardMarkup().trim();
      const card = template.content.firstElementChild;
      container.insertBefore(card, container.lastElementChild || null);
      card.querySelector('#home-review-prices')?.addEventListener('click', openDeferredPriceReview);
    }
    const dot = document.getElementById('nav-pending-dot');
    if (dot) dot.style.display = deferredPriceItems.length ? '' : 'none';
  }

  async function refreshDeferredPriceState() {
    try {
      deferredPriceItems = await api.shoppingTrips.deferredPrices();
    } catch (_) {
      deferredPriceItems = [];
    }
    renderDeferredHomeCard();
    return deferredPriceItems;
  }

  async function openDeferredPriceReview() {
    await refreshDeferredPriceState();
    if (!deferredPriceItems.length) return showToast('No prices need review');

    openModal('Review prices', `
      <p class="text-muted text-sm">Add only the prices you know now. Anything left blank stays here for later.</p>
      <div class="deferred-price-list">
        ${deferredPriceItems.map((item, index) => `
          <label class="deferred-price-row">
            <span><strong>${escapeHtml(item.itemName)}</strong><small>${escapeHtml(item.storeName || 'Store')} · ${escapeHtml(new Date(item.completedAt).toLocaleDateString())}</small></span>
            <span class="deferred-price-input-wrap"><span>$</span><input class="form-control deferred-price-input" type="number" min="0" step="0.01" inputmode="decimal" data-index="${index}" placeholder="0.00" /></span>
          </label>`).join('')}
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Done for now</button>
        <button type="button" class="btn btn-primary" id="save-deferred-prices">Save entered prices</button>
      </div>`);

    document.getElementById('save-deferred-prices')?.addEventListener('click', saveDeferredPrices);
  }

  async function saveDeferredPrices() {
    const button = document.getElementById('save-deferred-prices');
    const updates = [...document.querySelectorAll('.deferred-price-input')]
      .map(input => ({ input, item: deferredPriceItems[Number(input.dataset.index)], raw: input.value.trim() }))
      .filter(entry => entry.raw !== '');
    if (!updates.length) return showToast('Enter at least one price, or choose Done for now');

    for (const update of updates) {
      const value = Number(update.raw);
      if (!Number.isFinite(value) || value < 0) {
        showToast(`Enter a valid price for ${update.item.itemName}`);
        update.input.focus();
        return;
      }
    }

    if (button) { button.disabled = true; button.textContent = 'Saving…'; }
    const results = await Promise.allSettled(updates.map(update => api.shoppingTrips.resolvePrice(
      update.item.tripId,
      update.item.shoppingListItemId,
      { price: Number(update.raw), storeId: update.item.storeId }
    )));
    const saved = results.filter(result => result.status === 'fulfilled').length;
    const failed = results.length - saved;

    closeModal();
    await refreshDeferredPriceState();
    if (document.getElementById('tab-home')?.classList.contains('active')) await loadHomeTab();
    showToast(failed
      ? `${saved} price${saved === 1 ? '' : 's'} saved · ${failed} could not be updated`
      : `${saved} price${saved === 1 ? '' : 's'} saved · Spending updated`, 5000);
  }

  const baseLoadShoppingListTab = loadShoppingListTab;
  loadShoppingListTab = async function parentFirstLoadShoppingListTab() {
    const result = await baseLoadShoppingListTab();
    applyOutcomeLabels();
    void refreshExternalShoppingPrices();
    return result;
  };

  const baseLoadHomeTab = loadHomeTab;
  loadHomeTab = async function parentFirstLoadHomeTab() {
    const [result] = await Promise.all([
      baseLoadHomeTab(),
      refreshDeferredPriceState()
    ]);
    renderDeferredHomeCard();
    applyOutcomeLabels();
    return result;
  };

  applyOutcomeLabels();
})();
