// Rapid multi-item shopping-list capture.
// This intentionally reuses the current catalog/list APIs instead of introducing
// a parallel shopping workflow.

(function () {
  const MAX_CAPTURE_ITEMS = 25;
  const MAX_QUANTITY = 99;

  function normalizeRapidName(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  function serializeRapidToken(token) {
    return token.quantity === 1 ? token.name : `${token.name} x${token.quantity}`;
  }

  function parseRapidShoppingTokens(value) {
    const parts = String(value || '')
      .split(/[\n,;]+/)
      .map(part => part.trim())
      .filter(Boolean);

    if (parts.length > MAX_CAPTURE_ITEMS) {
      return {
        tokens: [],
        invalid: [],
        error: `Add no more than ${MAX_CAPTURE_ITEMS} items at once.`
      };
    }

    const tokens = [];
    const invalid = [];

    parts.forEach(raw => {
      const quantityMatch = raw.match(/^(.*?)(?:\s+(?:x|×)\s*(\d+))$/i);
      const name = String(quantityMatch?.[1] ?? raw).trim();
      const quantity = quantityMatch ? Number(quantityMatch[2]) : 1;

      if (!normalizeRapidName(name) || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
        invalid.push(raw);
        return;
      }

      tokens.push({ name, quantity });
    });

    return { tokens, invalid, error: null };
  }

  function findRapidCatalogMatch(catalog, requestedName) {
    const target = normalizeRapidName(requestedName);
    if (!target) return null;

    const exact = catalog.filter(item => normalizeRapidName(item.name) === target);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;

    const candidates = catalog.filter(item => {
      const itemName = normalizeRapidName(item.name);
      const brand = normalizeRapidName(item.brand);
      return itemName.includes(target) ||
        (itemName.length >= 3 && target.includes(itemName)) ||
        (brand && brand.includes(target));
    });

    return candidates.length === 1 ? candidates[0] : null;
  }

  function setRapidCaptureStatus(message, state = '') {
    const status = document.getElementById('rapid-list-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  async function submitRapidShoppingCapture(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = document.getElementById('rapid-list-input');
    const submit = form.querySelector('button[type="submit"]');
    const parsed = parseRapidShoppingTokens(input?.value);

    if (parsed.error) {
      setRapidCaptureStatus(parsed.error, 'warning');
      return;
    }
    if (!parsed.tokens.length && !parsed.invalid.length) return;

    submit.disabled = true;
    submit.textContent = 'Adding…';
    setRapidCaptureStatus('Matching your list…');

    try {
      const catalog = await api.items.list();
      const unresolved = parsed.invalid.map(name => ({ name, quantity: 1 }));
      const matchedById = new Map();

      parsed.tokens.forEach(token => {
        const item = findRapidCatalogMatch(catalog, token.name);
        if (!item) {
          unresolved.push(token);
          return;
        }
        const key = String(item._id);
        const existing = matchedById.get(key);
        if (existing) {
          existing.quantity += token.quantity;
          existing.sourceNames.push(token.name);
        } else {
          matchedById.set(key, {
            item,
            quantity: token.quantity,
            sourceNames: [token.name]
          });
        }
      });

      const activeListByItemId = new Map(
        listState.items
          .filter(entry => !entry.checked)
          .map(entry => [String(entry.itemId?._id || entry.itemId), entry])
      );

      const operations = [];
      matchedById.forEach(match => {
        const existing = activeListByItemId.get(String(match.item._id));
        const nextQuantity = Number(existing?.quantity || 0) + match.quantity;

        if (match.quantity > MAX_QUANTITY || nextQuantity > MAX_QUANTITY) {
          unresolved.push({ name: match.sourceNames[0], quantity: match.quantity });
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
      const failed = [];
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

      const needsReview = [...unresolved, ...failed];
      if (input) input.value = needsReview.map(serializeRapidToken).join(', ');

      if (needsReview.length) {
        const addedText = addedCount ? `Added ${addedCount}. ` : '';
        setRapidCaptureStatus(
          `${addedText}${needsReview.length} ${needsReview.length === 1 ? 'item needs' : 'items need'} review. Use + Add for new or ambiguous products.`,
          'warning'
        );
        if (addedCount) showToast(`Added ${addedCount} item${addedCount === 1 ? '' : 's'}; ${needsReview.length} need review`, 4000);
      } else {
        setRapidCaptureStatus(`Added ${addedCount} item${addedCount === 1 ? '' : 's'}.`, 'success');
        showToast(`Added ${addedCount} item${addedCount === 1 ? '' : 's'} to the list`);
      }

      input?.focus({ preventScroll: true });
    } catch (err) {
      setRapidCaptureStatus('Could not add those items. Try again.', 'warning');
      handleError(err, 'Failed to add shopping items');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Add';
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
      <label class="sr-only" for="rapid-list-input">Quick add shopping items</label>
      <div class="rapid-list-row">
        <textarea id="rapid-list-input" class="form-control" rows="1" autocomplete="off"
          placeholder="Milk, eggs, bananas x2…" aria-describedby="rapid-list-hint rapid-list-status"></textarea>
        <button type="submit" class="btn btn-primary">Add</button>
      </div>
      <div class="rapid-list-meta">
        <span id="rapid-list-hint">Separate items with commas. Add x2 for quantity.</span>
        <span id="rapid-list-status" role="status" aria-live="polite"></span>
      </div>`;

    summary.before(form);
    form.addEventListener('submit', submitRapidShoppingCapture);

    const input = document.getElementById('rapid-list-input');
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  }

  window.initRapidShoppingCapture = initRapidShoppingCapture;
  window.parseRapidShoppingTokens = parseRapidShoppingTokens;
})();
