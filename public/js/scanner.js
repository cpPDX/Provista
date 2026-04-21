// BarcodeScanner — camera-based barcode scanning with Open Food Facts lookup.
// Provides window.BarcodeScanner singleton and window.handleBarcodeResult helper.

window.BarcodeScanner = (() => {
  let _stream = null;
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
    try {
      if (_stream) {
        _stream.getTracks().forEach(t => t.stop());
        _stream = null;
      }
    } catch (_) {}
    const video = document.getElementById('scanner-video');
    if (video) { video.srcObject = null; }
  }

  function close() {
    _stopCamera();
    document.getElementById('scanner-overlay').style.display = 'none';
    document.getElementById('scanner-manual-wrap').style.display = 'none';
    document.getElementById('scanner-manual-input').value = '';
    document.getElementById('scanner-status').textContent = 'Align barcode within the frame';
    _onResultCallback = null;
  }

  function _deliver(upc) {
    const cb = _onResultCallback;
    close();
    if (cb) cb(upc);
  }

  async function open(onResult) {
    if (!_isAvailable()) {
      if (onResult) onResult(null);
      return;
    }

    _onResultCallback = onResult;

    const overlay = document.getElementById('scanner-overlay');
    overlay.style.display = 'flex';

    // Wire close button
    document.getElementById('scanner-close-btn').onclick = () => {
      close();
      if (onResult) onResult(null);
    };

    // Wire manual toggle
    document.getElementById('scanner-manual-toggle').onclick = () => {
      _stopCamera();
      const manualWrap = document.getElementById('scanner-manual-wrap');
      manualWrap.style.display = 'flex';
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

    const status = document.getElementById('scanner-status');

    if (!navigator.mediaDevices?.getUserMedia) {
      status.textContent = 'Camera not supported on this device.';
      document.getElementById('scanner-manual-wrap').style.display = 'flex';
      return;
    }

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }
      });
    } catch (err) {
      console.warn('Camera access denied:', err);
      status.textContent = 'Camera access denied. Use manual entry below.';
      document.getElementById('scanner-manual-wrap').style.display = 'flex';
      return;
    }

    const video = document.getElementById('scanner-video');
    video.srcObject = _stream;

    if (!window.ZXing) {
      status.textContent = 'Barcode library not loaded. Use manual entry.';
      document.getElementById('scanner-manual-wrap').style.display = 'flex';
      return;
    }

    const hints = new Map();
    const formats = [
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8
    ];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);

    _codeReader = new ZXing.BrowserMultiFormatReader(hints);

    try {
      await _codeReader.decodeFromStream(_stream, video, (result, err) => {
        if (result) {
          _deliver(result.getText());
        }
      });
    } catch (err) {
      console.warn('ZXing decode error:', err);
      status.textContent = 'Could not start scanner. Use manual entry.';
      document.getElementById('scanner-manual-wrap').style.display = 'flex';
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
    // Not found anywhere — open create item modal with UPC pre-noted
    _openBarcodeConfirmModal(result, onItem);
    return;
  }

  if (result.source === 'local') {
    // Already in household catalog — use directly
    onItem(result.item);
    return;
  }

  // Found on Open Food Facts
  if (result.confidence === 'full' && result.autoAccept) {
    // Auto-accept: create silently and hand back
    await _createItemFromBarcode(result.item, onItem);
    return;
  }

  // Show confirmation UI
  _openBarcodeConfirmModal(result, onItem);
}

function _openBarcodeConfirmModal(result, onItem) {
  const item = result.item || {};
  const missing = result.missingFields || ['name', 'category', 'unit'];
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
    // Full match — just confirm
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
    // Partial or not found — editable form
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
