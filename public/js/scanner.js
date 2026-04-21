// BarcodeScanner — camera-based barcode scanning with Open Food Facts lookup.
// Provides window.BarcodeScanner singleton and window.handleBarcodeResult helper.

window.BarcodeScanner = (() => {
  let _codeReader = null;
  let _onResultCallback = null;

  function _isAvailable() {
    return window.appAuth?.features?.barcodeScanning;
  }

  function _stopCamera() {
    try {
      if (_codeReader) {
        _codeReader.reset();
        _codeReader = null;
      }
    } catch (_) {}
  }

  function close() {
    _stopCamera();
    const overlay = document.getElementById('scanner-overlay');
    if (overlay) overlay.style.display = 'none';
    const manualWrap = document.getElementById('scanner-manual-wrap');
    if (manualWrap) manualWrap.style.display = 'none';
    const manualInput = document.getElementById('scanner-manual-input');
    if (manualInput) manualInput.value = '';
    const status = document.getElementById('scanner-status');
    if (status) status.textContent = 'Align barcode within the frame';
    _onResultCallback = null;
  }

  function _deliver(upc) {
    const cb = _onResultCallback;
    close();
    if (cb) cb(upc);
  }

  function _showError(message) {
    const status = document.getElementById('scanner-status');
    if (status) status.textContent = message;
    const manualWrap = document.getElementById('scanner-manual-wrap');
    if (manualWrap) manualWrap.style.display = 'flex';
  }

  async function open(onResult) {
    if (!_isAvailable()) {
      if (onResult) onResult(null);
      return;
    }

    _onResultCallback = onResult;

    const overlay = document.getElementById('scanner-overlay');
    if (!overlay) {
      // scanner HTML missing from DOM — likely a stale service worker cache
      showToast('Scanner unavailable. Try reloading the page.', 4000);
      if (onResult) onResult(null);
      return;
    }
    overlay.style.display = 'flex';

    // Wire close button
    document.getElementById('scanner-close-btn').onclick = () => {
      close();
      if (onResult) onResult(null);
    };

    // Wire manual toggle
    document.getElementById('scanner-manual-toggle').onclick = () => {
      _stopCamera();
      document.getElementById('scanner-manual-wrap').style.display = 'flex';
      document.getElementById('scanner-manual-input').focus();
    };

    // Wire manual submit
    document.getElementById('scanner-manual-submit').onclick = () => {
      const val = document.getElementById('scanner-manual-input').value.trim();
      if (val) _deliver(val);
    };
    document.getElementById('scanner-manual-input').onkeydown = (e) => {
      if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (val) _deliver(val);
      }
    };

    if (!window.ZXing?.BrowserMultiFormatReader) {
      _showError('Barcode library not loaded. Use manual entry below.');
      return;
    }

    // Use decodeFromConstraints — lets ZXing call getUserMedia internally,
    // which is required for reliable camera access on iOS Safari.
    // Do NOT construct hints using ZXing.BarcodeFormat: those enum references
    // are unreliable in the UMD bundle and cause silent TypeErrors on some browsers.
    _codeReader = new ZXing.BrowserMultiFormatReader();

    try {
      const video = document.getElementById('scanner-video');
      await _codeReader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        video,
        (result, err) => {
          if (result) {
            _deliver(result.getText());
          }
          // err fires on every frame that doesn't decode — that's expected, ignore it
        }
      );
    } catch (err) {
      console.warn('ZXing scanner error:', err);
      if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
        _showError('Camera access denied. Use manual entry below.');
      } else if (err && err.name === 'NotFoundError') {
        _showError('No camera found. Use manual entry below.');
      } else {
        _showError('Could not start scanner. Use manual entry below.');
      }
    }
  }

  return { open, close };
})();

/**
 * Runs the full barcode lookup → confirmation flow.
 * Calls onItem(item) with a fully resolved item (existing or newly created).
 *
 * @param {string} upc
 * @param {function} onItem  - called with the resolved item object
 */
async function handleBarcodeResult(upc, onItem) {
  if (!upc) return;

  let result;
  try {
    result = await api.barcode.lookup(upc);
  } catch (err) {
    showToast('Barcode lookup failed. Try again.', 3000);
    console.error('Barcode lookup error:', err);
    return;
  }

  if (!result.found) {
    _openBarcodeConfirmModal(result, onItem);
    return;
  }

  if (result.source === 'local') {
    onItem(result.item);
    return;
  }

  // Found on Open Food Facts
  if (result.confidence === 'full' && result.autoAccept) {
    await _createItemFromBarcode(result.item, onItem);
    return;
  }

  _openBarcodeConfirmModal(result, onItem);
}

function _openBarcodeConfirmModal(result, onItem) {
  const item = result.item || {};
  const isNotFound = !result.found;

  const categories = [
    'Bakery', 'Beverages', 'Cleaning & Household', 'Condiments & Sauces',
    'Dairy', 'Deli', 'Frozen', 'Meat & Seafood', 'Pantry', 'Produce', 'Snacks'
  ];
  const units = ['each', 'lb', 'oz', 'kg', 'g', 'fl oz', 'ml', 'l', 'ct', 'pack', 'gal', 'qt', 'pt'];

  const categoryOptions = categories
    .map(c => `<option value="${escapeAttr(c)}"${item.category === c ? ' selected' : ''}>${escapeHtml(c)}</option>`)
    .join('');
  const unitOptions = units
    .map(u => `<option value="${escapeAttr(u)}"${item.unit === u ? ' selected' : ''}>${escapeHtml(u)}</option>`)
    .join('');

  const isPartial = result.confidence === 'partial' || isNotFound;

  let bodyHTML;

  if (!isPartial) {
    bodyHTML = `
      <div class="barcode-result-summary">
        <div class="barcode-result-name">${escapeHtml(item.name)}</div>
        ${item.brand ? `<div class="text-muted text-sm">${escapeHtml(item.brand)}</div>` : ''}
        <div class="barcode-result-meta">
          ${escapeHtml(item.category)} &middot; ${escapeHtml(item.unit)}
          ${item.isOrganic ? '<span class="badge badge-organic">Organic</span>' : ''}
        </div>
        <div class="barcode-upc-display">${escapeHtml(item.upc || '')}</div>
      </div>
      <p class="text-muted text-sm">Scanned from Open Food Facts</p>
      <form id="barcode-confirm-form">
        <input type="hidden" name="confirmed" value="1">
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-full">Use This Item</button>
        </div>
      </form>`;
  } else {
    const helpText = isNotFound
      ? 'Barcode not in our database. Fill in the details to add it.'
      : 'Some details are missing. Fill them in to complete the item.';

    bodyHTML = `
      <p class="text-muted text-sm">${escapeHtml(helpText)}</p>
      ${item.upc ? `<div class="barcode-upc-display">${escapeHtml(item.upc)}</div>` : ''}
      <form id="barcode-confirm-form">
        <div class="form-group">
          <label>Item Name *</label>
          <input type="text" name="name" class="form-control" required value="${escapeAttr(item.name || '')}" placeholder="e.g. Organic Whole Milk">
        </div>
        <div class="form-group">
          <label>Brand</label>
          <input type="text" name="brand" class="form-control" value="${escapeAttr(item.brand || '')}" placeholder="Optional">
        </div>
        <div class="form-group">
          <label>Category *</label>
          <select name="category" class="form-control" required>
            <option value="">Select category…</option>
            ${categoryOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Unit *</label>
          <select name="unit" class="form-control" required>
            <option value="">Select unit…</option>
            ${unitOptions}
          </select>
        </div>
        <div class="form-group form-check">
          <label><input type="checkbox" name="isOrganic"${item.isOrganic ? ' checked' : ''}> Organic</label>
        </div>
        <p class="text-muted text-sm">Filling in missing info saves it for future scans.</p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-full">Add Item</button>
        </div>
      </form>`;
  }

  openModal(isNotFound ? 'Add New Item' : 'Confirm Item', bodyHTML, async (form) => {
    const data = isPartial
      ? {
          name: form.name.value.trim(),
          brand: form.brand.value.trim(),
          category: form.category.value,
          unit: form.unit.value,
          isOrganic: form.isOrganic?.checked || false,
          upc: item.upc || null,
          upcSource: 'scan'
        }
      : { ...item, upcSource: 'scan' };

    if (!data.name) { showToast('Item name is required', 2500); return; }
    if (!data.category) { showToast('Category is required', 2500); return; }
    if (!data.unit) { showToast('Unit is required', 2500); return; }

    await _createItemFromBarcode(data, onItem);
  });
}

async function _createItemFromBarcode(itemData, onItem) {
  try {
    const created = await api.items.create(itemData);
    closeModal();
    onItem(created);
  } catch (err) {
    console.error('Failed to create item from barcode:', err);
    showToast(err.message || 'Failed to save item', 3000);
  }
}
