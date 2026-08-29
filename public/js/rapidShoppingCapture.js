// Rapid multi-item shopping-list capture.
// Matching is performed by the shared deterministic server-side matcher so
// List, meal planning, receipts, and future capture flows use one contract.

(function () {
  const MAX_QUANTITY = 99;
  let pendingReviewTokens = [];
  let pendingCapture = null;

  function serializeRapidToken(token) {
    return token.quantity === 1 ? token.name : `${token.name} x${token.quantity}`;
  }

  function updateReviewButton() {
    const button = document.getElementById('rapid-review-details');
    if (!button) return;
    button.hidden = pendingReviewTokens.length === 0;
    button.textContent = pendingReviewTokens.length === 1
      ? 'Review 1 item with details'
      : `Review ${pendingReviewTokens.length} items with details`;
  }

  function setRapidCaptureStatus(message, state = '') {
    const status = document.getElementById('rapid-list-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
    updateReviewButton();
  }

  function syncPendingInput() {
    const input = document.getElementById('rapid-list-input');
    if (input) input.value = pendingReviewTokens.map(serializeRapidToken).join(', ');
    updateReviewButton();
  }

  function clearRapidPreview() {
    pendingCapture = null;
    const preview = document.getElementById('rapid-list-preview');
    if (!preview) return;
    preview.replaceChildren();
    preview.hidden = true;
  }

  function reviewNextRapidItem() {
    const token = pendingReviewTokens[0];
    if (!token) return;
    openAddListItemModal(token.name, {
      onAdded: () => {
        pendingReviewTokens.shift();
        syncPendingInput();
        if (pendingReviewTokens.length) {
          setRapidCaptureStatus(
            `${pendingReviewTokens.length} ${pendingReviewTokens.length === 1 ? 'item still needs' : 'items still need'} details.`,
            'warning'
          );
        } else {
          setRapidCaptureStatus('All items added.', 'success');
          document.getElementById('rapid-list-input')?.focus({ preventScroll: true });
        }
      }
    });
    const quantityInput = document.getElementById('list-qty');
    if (quantityInput && token.quantity > 1) quantityInput.value = String(token.quantity);
  }

  function aggregateMatchedSuggestions(suggestions) {
    const byItemId = new Map();

    suggestions.forEach(suggestion => {
      if (suggestion.matchStatus !== 'matched' || !suggestion.item?._id) return;
      const key = String(suggestion.item._id);
      const existing = byItemId.get(key);
      if (existing) {
        existing.quantity += Number(suggestion.quantity) || 1;
        existing.sourceNames.push(suggestion.sourceText);
      } else {
        byItemId.set(key, {
          item: suggestion.item,
          quantity: Number(suggestion.quantity) || 1,
          sourceNames: [suggestion.sourceText]
        });
      }
    });

    return [...byItemId.values()];
  }

  function unresolvedTokens(suggestions) {
    return suggestions
      .filter(suggestion => suggestion.matchStatus !== 'matched')
      .map(suggestion => ({
        name: suggestion.sourceText,
        quantity: Number(suggestion.quantity) || 1
      }));
  }

  async function addMatchedSuggestions(suggestions) {
    const matched = aggregateMatchedSuggestions(suggestions);
    if (!matched.length) return { addedCount: 0, failed: [] };

    const activeListByItemId = new Map(
      listState.items
        .filter(entry => !entry.checked)
        .map(entry => [String(entry.itemId?._id || entry.itemId), entry])
    );
    const operations = [];
    const failed = [];

    matched.forEach(match => {
      const existing = activeListByItemId.get(String(match.item._id));
      const nextQuantity = Number(existing?.quantity || 0) + match.quantity;

      if (match.quantity > MAX_QUANTITY || nextQuantity > MAX_QUANTITY) {
        failed.push({ name: match.sourceNames[0], quantity: match.quantity });
        return;
      }

      operations.push({
        name: match.item.name,
        quantity: match.quantity,
        run: () => existing
          ? api.shoppingList.update(existing._id, { quantity: nextQuantity })
          : api.shoppingList.add({ itemId: match.item._id, quantity: match.quantity })
      });
    });

    const results = await Promise.allSettled(operations.map(operation => operation.run()));
    let addedCount = 0;

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        addedCount += 1;
      } else {
        failed.push({ name: operations[index].name, quantity: operations[index].quantity });
        console.error(result.reason);
      }
    });

    if (addedCount) await loadShoppingListTab();
    return { addedCount, failed };
  }

  function createPreviewRow(suggestion) {
    const row = document.createElement('li');
    row.className = `rapid-preview-item rapid-preview-${suggestion.matchStatus}`;

    const main = document.createElement('span');
    main.className = 'rapid-preview-main';
    const quantity = Number(suggestion.quantity) || 1;
    const requested = quantity === 1
      ? suggestion.sourceText
      : `${suggestion.sourceText} × ${quantity}`;

    if (suggestion.matchStatus === 'matched') {
      main.textContent = quantity === 1
        ? suggestion.item.name
        : `${suggestion.item.name} × ${quantity}`;
    } else {
      main.textContent = requested;
    }

    const state = document.createElement('span');
    state.className = 'rapid-preview-state';
    if (suggestion.matchStatus === 'matched') {
      state.textContent = 'Matched';
    } else if (suggestion.matchStatus === 'ambiguous') {
      const names = (suggestion.candidates || []).slice(0, 2).map(candidate => candidate.name).filter(Boolean);
      state.textContent = names.length
        ? `Needs a choice: ${names.join(' or ')}`
        : 'Needs a choice';
    } else {
      state.textContent = 'Needs details';
    }

    row.append(main, state);
    return row;
  }

  function renderRapidPreview(matchResult) {
    const preview = document.getElementById('rapid-list-preview');
    if (!preview) return;

    const suggestions = matchResult.suggestions || [];
    const matchedCount = suggestions.filter(item => item.matchStatus === 'matched').length;
    const unresolvedCount = suggestions.length - matchedCount;
    pendingCapture = { suggestions };

    preview.replaceChildren();
    preview.hidden = false;

    const heading = document.createElement('div');
    heading.className = 'rapid-preview-heading';
    heading.textContent = 'Review before adding';

    const list = document.createElement('ul');
    list.className = 'rapid-preview-list';
    suggestions.forEach(suggestion => list.appendChild(createPreviewRow(suggestion)));

    const actions = document.createElement('div');
    actions.className = 'rapid-preview-actions';

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-primary';
    if (matchedCount && unresolvedCount) {
      confirm.textContent = `Add ${matchedCount} & review ${unresolvedCount}`;
    } else if (matchedCount) {
      confirm.textContent = `Add ${matchedCount} ${matchedCount === 1 ? 'item' : 'items'}`;
    } else {
      confirm.textContent = `Review ${unresolvedCount} ${unresolvedCount === 1 ? 'item' : 'items'}`;
    }
    confirm.addEventListener('click', confirmRapidCapture);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-secondary';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => {
      clearRapidPreview();
      setRapidCaptureStatus('Edit the list, then add again.');
      document.getElementById('rapid-list-input')?.focus({ preventScroll: true });
    });

    actions.append(confirm, edit);
    preview.append(heading, list, actions);
  }

  async function confirmRapidCapture() {
    const capture = pendingCapture;
    if (!capture) return;

    const preview = document.getElementById('rapid-list-preview');
    const confirm = preview?.querySelector('.btn-primary');
    if (confirm) confirm.disabled = true;

    try {
      const unresolved = unresolvedTokens(capture.suggestions);
      const { addedCount, failed } = await addMatchedSuggestions(capture.suggestions);
      pendingReviewTokens = [...unresolved, ...failed];
      clearRapidPreview();
      syncPendingInput();

      if (pendingReviewTokens.length) {
        const addedText = addedCount ? `Added ${addedCount}. ` : '';
        setRapidCaptureStatus(
          `${addedText}${pendingReviewTokens.length} ${pendingReviewTokens.length === 1 ? 'item needs' : 'items need'} details.`,
          'warning'
        );
        if (addedCount) {
          showToast(
            `Added ${addedCount} item${addedCount === 1 ? '' : 's'}; ${pendingReviewTokens.length} need details`,
            4000
          );
        }
        reviewNextRapidItem();
        return;
      }

      const input = document.getElementById('rapid-list-input');
      if (input) input.value = '';
      setRapidCaptureStatus(`Added ${addedCount} item${addedCount === 1 ? '' : 's'}.`, 'success');
      showToast(`Added ${addedCount} item${addedCount === 1 ? '' : 's'} to the list`);
      input?.focus({ preventScroll: true });
    } catch (err) {
      setRapidCaptureStatus('Could not add those items. Try again.', 'warning');
      handleError(err, 'Failed to add shopping items');
      if (confirm) confirm.disabled = false;
    }
  }

  async function submitRapidShoppingCapture(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = document.getElementById('rapid-list-input');
    const submit = form.querySelector('button[type="submit"]');
    const text = input?.value || '';
    if (!text.trim()) return;

    pendingReviewTokens = [];
    clearRapidPreview();
    updateReviewButton();
    submit.disabled = true;
    submit.textContent = 'Matching…';
    setRapidCaptureStatus('Matching your list…');

    try {
      const matchResult = await api.items.match(text);
      const suggestions = matchResult.suggestions || [];
      const matched = suggestions.filter(item => item.matchStatus === 'matched');
      const unresolved = suggestions.filter(item => item.matchStatus !== 'matched');

      // Preserve the fastest possible path for one clear item. Multi-item or
      // ambiguous input always gets a compact review before anything changes.
      if (suggestions.length === 1 && matched.length === 1 && unresolved.length === 0) {
        const { addedCount, failed } = await addMatchedSuggestions(suggestions);
        if (failed.length) {
          pendingReviewTokens = failed;
          syncPendingInput();
          setRapidCaptureStatus('That item needs details before it can be added.', 'warning');
          reviewNextRapidItem();
          return;
        }

        input.value = '';
        setRapidCaptureStatus('Added 1 item.', 'success');
        showToast('Added 1 item to the list');
        input.focus({ preventScroll: true });
        return;
      }

      renderRapidPreview(matchResult);
      if (unresolved.length) {
        setRapidCaptureStatus(
          `${unresolved.length} ${unresolved.length === 1 ? 'item needs' : 'items need'} review before the list changes.`,
          'warning'
        );
      } else {
        setRapidCaptureStatus(`Review ${matched.length} matched items before adding.`);
      }
    } catch (err) {
      setRapidCaptureStatus('Could not match those items. Try again.', 'warning');
      handleError(err, 'Failed to match shopping items');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Add to list';
    }
  }

  function installRapidCaptureStyles() {
    if (document.querySelector('link[data-rapid-shopping-capture]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/rapidShoppingCapture.css';
    link.dataset.rapidShoppingCapture = 'true';
    document.head.appendChild(link);
  }

  function initRapidShoppingCapture() {
    if (document.getElementById('rapid-list-capture')) return;
    const summary = document.getElementById('list-summary');
    if (!summary) return;

    installRapidCaptureStyles();

    const form = document.createElement('form');
    form.id = 'rapid-list-capture';
    form.className = 'rapid-list-capture';
    form.innerHTML = `
      <label class="rapid-list-label" for="rapid-list-input">Add groceries</label>
      <div class="rapid-list-row">
        <textarea id="rapid-list-input" class="form-control" rows="1" autocomplete="off"
          placeholder="Milk, eggs, 2 cans black beans…" aria-describedby="rapid-list-hint rapid-list-status"></textarea>
        <button type="submit" class="btn btn-primary">Add to list</button>
      </div>
      <div class="rapid-list-meta">
        <span id="rapid-list-hint">Type several items at once. Separate with commas; quantities can be natural language or x2.</span>
        <span id="rapid-list-status" role="status" aria-live="polite"></span>
        <button type="button" class="btn-link" id="rapid-review-details" hidden>Review details</button>
      </div>
      <div id="rapid-list-preview" class="rapid-list-preview" hidden></div>`;

    summary.before(form);
    form.addEventListener('submit', submitRapidShoppingCapture);
    document.getElementById('rapid-review-details')?.addEventListener('click', reviewNextRapidItem);

    const input = document.getElementById('rapid-list-input');
    input.addEventListener('input', () => {
      if (pendingCapture) clearRapidPreview();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  }

  window.initRapidShoppingCapture = initRapidShoppingCapture;
})();
