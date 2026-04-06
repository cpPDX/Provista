// Receipt Scanning tab logic
// Uses Tesseract.js loaded on demand from CDN

let scanState = {
  parsedLines: [],
  imageDataUrl: null
};

function initScanTab() {
  const fileInput = document.getElementById('scan-file-input');

  document.getElementById('btn-camera').addEventListener('click', () => {
    fileInput.setAttribute('capture', 'environment');
    fileInput.click();
  });

  document.getElementById('btn-upload').addEventListener('click', () => {
    fileInput.removeAttribute('capture');
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileInput.value = '';
    await processReceiptFile(file);
  });

  document.getElementById('btn-save-scan').addEventListener('click', saveScannedItems);

  // Store autocomplete for scan screen
  const scanStoreInput = document.getElementById('scan-store');
  const scanStoreDropdown = document.getElementById('scan-store-dropdown');
  attachStoreAutocomplete(scanStoreInput, scanStoreDropdown, {
    onSelect(store) {
      scanStoreInput.dataset.storeId = store._id;
    },
    onCreateNew(name) {
      promptCreateStore(name, (store) => {
        scanStoreInput.value = store.name;
        scanStoreInput.dataset.storeId = store._id;
      });
    }
  });

  document.getElementById('scan-date').value = new Date().toISOString().slice(0, 10);
}

// Called when switching to the scan tab — loads pending section for admins
async function loadScanTab() {
  if (window.appAuth?.isAdmin()) {
    await loadScanPendingSection();
  }
}

async function loadScanPendingSection() {
  const section = document.getElementById('scan-pending-section');
  const container = document.getElementById('scan-pending-list');
  if (!section || !container) return;
  section.style.display = '';

  try {
    const entries = await api.prices.pending();
    updatePendingBadge(entries.length);

    if (!entries.length) {
      container.innerHTML = emptyState('✅', 'No entries pending review.');
      return;
    }

    container.innerHTML = entries.map(e => {
      const name = e.itemId?.name || 'Unknown item';
      const unit = e.itemId?.unit || 'unit';
      const store = e.storeId?.name || 'Unknown store';
      const submitter = e.submittedBy?.name || 'Unknown';
      const hasSale = e.salePrice != null;
      const hasCoupon = e.couponAmount != null && e.couponAmount > 0;
      return `
        <div class="pending-card" id="scan-pending-${e._id}">
          <div class="pending-card-header">
            <div>
              <div style="font-weight:600">${name}</div>
              <div class="text-muted text-sm">${store} &middot; ${formatDate(e.date)} &middot; by ${submitter}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;font-size:1.1rem">${formatCurrency(e.finalPrice)}</div>
              <div class="text-muted text-sm">${formatPPU(e.pricePerUnit, unit)}</div>
              ${hasSale ? `<span class="badge badge-sale">Sale</span>` : ''}
              ${hasCoupon ? `<span class="badge badge-coupon">Coupon</span>` : ''}
            </div>
          </div>
          ${e.notes ? `<div class="text-muted text-sm">${e.notes}</div>` : ''}
          <div class="pending-card-actions">
            <button class="btn btn-outline btn-sm" onclick="openApproveScanModal('${e._id}', ${JSON.stringify(e).replace(/"/g, '&quot;')})">Edit &amp; Approve</button>
            <button class="btn btn-primary btn-sm" onclick="quickApproveScan('${e._id}')">Approve ✓</button>
            <button class="btn btn-danger btn-sm" onclick="rejectScanEntry('${e._id}')">Reject</button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = emptyState('⚠️', 'Failed to load pending entries.');
  }
}

async function quickApproveScan(id) {
  try {
    await api.prices.approve(id);
    showToast('Entry approved');
    await loadScanPendingSection();
    await loadPricesTab();
  } catch (err) {
    handleError(err, 'Failed to approve entry');
  }
}

function openApproveScanModal(id, entryRaw) {
  openApproveModal(id, entryRaw, async () => {
    await loadScanPendingSection();
    await loadPricesTab();
  });
}

async function rejectScanEntry(id) {
  if (!confirm('Reject and delete this entry?')) return;
  try {
    await api.prices.reject(id);
    showToast('Entry rejected');
    await loadScanPendingSection();
  } catch (err) {
    handleError(err, 'Failed to reject entry');
  }
}

async function processReceiptFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    scanState.imageDataUrl = e.target.result;
    document.getElementById('scan-image').src = e.target.result;
    document.getElementById('scan-preview').style.display = '';
  };
  reader.readAsDataURL(file);

  document.getElementById('scan-results').style.display = 'none';
  document.getElementById('scan-progress').style.display = '';

  try {
    const text = await runOCR(file);
    const parsed = parseReceiptText(text);
    scanState.parsedLines = parsed.lines;

    if (parsed.storeName) {
      document.getElementById('scan-store').value = parsed.storeName;
    }
    if (parsed.date) {
      document.getElementById('scan-date').value = parsed.date;
    }

    document.getElementById('scan-progress').style.display = 'none';
    renderScanLineItems(parsed.lines);
    document.getElementById('scan-results').style.display = '';
  } catch (err) {
    document.getElementById('scan-progress').style.display = 'none';
    handleError(err, 'OCR failed. Please try a clearer image.');
  }
}

async function runOCR(file) {
  if (!window.Tesseract) {
    await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
  }
  const statusEl = document.getElementById('scan-status');
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        const pct = Math.round((m.progress || 0) * 100);
        statusEl.textContent = `Processing... ${pct}%`;
      }
    }
  });
  const result = await worker.recognize(file);
  await worker.terminate();
  return result.data.text;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function parseReceiptText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const result = { lines: [], storeName: null, date: null };

  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(\w{3,9})\s+(\d{1,2})[,\s]+(\d{4})/
  ];
  for (const line of lines) {
    for (const pat of datePatterns) {
      const m = line.match(pat);
      if (m) {
        const d = new Date(m[0]);
        if (!isNaN(d.getTime())) { result.date = d.toISOString().slice(0, 10); break; }
      }
    }
    if (result.date) break;
  }

  if (lines.length > 0 && lines[0].length < 40) result.storeName = lines[0];

  const priceLineRe = /^(.+?)\s+\$?([\d]+\.[\d]{2})\s*[a-zA-Z]?$/;
  const skipWords = /^(total|subtotal|tax|change|cash|credit|debit|balance|thank|welcome|receipt|store|tel|phone|date|time|item|qty|amount|sale|savings|you\s+saved)/i;

  for (const line of lines) {
    const m = line.match(priceLineRe);
    if (!m) continue;
    const name = m[1].trim();
    const price = parseFloat(m[2]);
    if (skipWords.test(name)) continue;
    if (name.length < 2 || price <= 0 || price > 500) continue;
    result.lines.push({ rawName: name, price, discard: false, itemId: null, itemName: name });
  }

  return result;
}

function renderScanLineItems(lines) {
  const container = document.getElementById('scan-line-items');
  if (!lines.length) {
    container.innerHTML = `<p class="text-muted text-sm">No line items could be parsed. You can still enter items manually via the Prices tab.</p>`;
    return;
  }

  container.innerHTML = lines.map((line, i) => `
    <div class="scan-line-item" id="scan-line-${i}">
      <div class="scan-line-item-header">
        <strong>Line ${i + 1}</strong>
        <label class="discard-toggle ${line.discard ? 'discarded' : ''}">
          <input type="checkbox" ${line.discard ? 'checked' : ''} onchange="toggleScanLineDiscard(${i}, this.checked)" />
          Discard
        </label>
      </div>
      <div class="scan-line-controls" ${line.discard ? 'style="opacity:0.5;pointer-events:none"' : ''}>
        <div class="form-group" style="margin-bottom:0.5rem">
          <label style="font-size:0.75rem;color:var(--text-muted)">Item Name</label>
          <div class="autocomplete-wrap">
            <input class="form-control" id="scan-line-name-${i}" value="${escapeHtml(line.itemName)}"
              placeholder="Match to item..." autocomplete="off" />
            <div class="autocomplete-dropdown" id="scan-line-dropdown-${i}"></div>
          </div>
          <input type="hidden" id="scan-line-itemid-${i}" value="${line.itemId || ''}" />
          <input type="hidden" id="scan-line-unit-${i}" value="${line.unit || ''}" />
        </div>
        <div class="form-row">
          <div class="form-group" style="margin-bottom:0">
            <label style="font-size:0.75rem;color:var(--text-muted)">Price Paid ($)</label>
            <input class="form-control" type="number" step="0.01" min="0" id="scan-line-price-${i}" value="${line.price.toFixed(2)}" />
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label style="font-size:0.75rem;color:var(--text-muted)">Quantity</label>
            <input class="form-control" type="number" step="any" min="0.01" id="scan-line-qty-${i}" value="1" />
          </div>
        </div>
      </div>
    </div>`).join('');

  // Attach autocomplete to each line
  lines.forEach((line, i) => {
    const input = document.getElementById(`scan-line-name-${i}`);
    const dropdown = document.getElementById(`scan-line-dropdown-${i}`);
    if (!input || !dropdown) return;
    attachItemAutocomplete(input, dropdown, {
      onSelect(item) {
        document.getElementById(`scan-line-itemid-${i}`).value = item._id;
        document.getElementById(`scan-line-unit-${i}`).value = item.unit;
        scanState.parsedLines[i].itemId = item._id;
        scanState.parsedLines[i].itemName = item.name;
        input.value = item.name;
      },
      onCreateNew(name) {
        promptCreateItem(name, (item) => {
          document.getElementById(`scan-line-itemid-${i}`).value = item._id;
          document.getElementById(`scan-line-unit-${i}`).value = item.unit;
          input.value = item.name;
          scanState.parsedLines[i].itemId = item._id;
        });
      }
    });
  });
}

function toggleScanLineDiscard(i, discarded) {
  scanState.parsedLines[i].discard = discarded;
  const controls = document.querySelector(`#scan-line-${i} .scan-line-controls`);
  const label = document.querySelector(`#scan-line-${i} .discard-toggle`);
  if (controls) controls.style.cssText = discarded ? 'opacity:0.5;pointer-events:none' : '';
  if (label) label.classList.toggle('discarded', discarded);
}

async function saveScannedItems() {
  const storeInput = document.getElementById('scan-store');
  const storeId = storeInput.dataset.storeId;
  const date = document.getElementById('scan-date').value;

  if (!storeId && storeInput.value.trim()) {
    showToast('Please select a store from the dropdown');
    return;
  }

  const toSave = [];
  for (let i = 0; i < scanState.parsedLines.length; i++) {
    const line = scanState.parsedLines[i];
    if (line.discard) continue;

    const itemId = document.getElementById(`scan-line-itemid-${i}`)?.value;
    if (!itemId) {
      showToast(`Line ${i + 1}: please match to an item before saving`);
      return;
    }

    // For receipts we treat the price paid as regularPrice = finalPrice
    const regularPrice = parseFloat(document.getElementById(`scan-line-price-${i}`).value);
    const quantity = parseFloat(document.getElementById(`scan-line-qty-${i}`).value);

    toSave.push({ itemId, storeId, regularPrice, finalPrice: regularPrice, quantity, date, source: 'receipt' });
  }

  if (!toSave.length) { showToast('No items to save'); return; }
  if (!storeId) { showToast('Please select or add a store'); return; }

  try {
    await Promise.all(toSave.map(entry => api.prices.create(entry)));
    showToast(`Saved ${toSave.length} price${toSave.length !== 1 ? 's' : ''} from receipt`);
    document.getElementById('scan-results').style.display = 'none';
    document.getElementById('scan-preview').style.display = 'none';
    scanState.parsedLines = [];
    storeInput.value = '';
    delete storeInput.dataset.storeId;
    if (document.getElementById('tab-prices').classList.contains('active')) {
      await loadPricesTab();
    }
    // Refresh pending section after scan save (new pending entries may exist)
    if (window.appAuth?.isAdmin()) await loadScanPendingSection();
  } catch (err) {
    handleError(err, 'Failed to save some items');
  }
}

// Shared approve modal (used by scan tab and more tab)
function openApproveModal(id, entryRaw, onSuccess) {
  const bodyHTML = `
    <form id="approve-form">
      <div class="form-row">
        <div class="form-group">
          <label>Regular Price ($)</label>
          <input class="form-control" type="number" step="0.01" min="0" id="approve-reg-price" value="${entryRaw.regularPrice}" required />
        </div>
        <div class="form-group">
          <label>Quantity</label>
          <input class="form-control" type="number" step="any" min="0.01" id="approve-qty" value="${entryRaw.quantity}" required />
        </div>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="approve-sale" ${entryRaw.salePrice != null ? 'checked' : ''} />
        <label for="approve-sale">On Sale</label>
      </div>
      <div id="approve-sale-group" style="${entryRaw.salePrice != null ? '' : 'display:none'}">
        <div class="form-group">
          <label>Sale Price ($)</label>
          <input class="form-control" type="number" step="0.01" min="0" id="approve-sale-price" value="${entryRaw.salePrice || ''}" />
        </div>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="approve-coupon" ${entryRaw.couponAmount != null ? 'checked' : ''} />
        <label for="approve-coupon">Used Coupon</label>
      </div>
      <div id="approve-coupon-group" style="${entryRaw.couponAmount != null ? '' : 'display:none'}">
        <div class="form-row">
          <div class="form-group">
            <label>Coupon Amount ($)</label>
            <input class="form-control" type="number" step="0.01" min="0" id="approve-coupon-amount" value="${entryRaw.couponAmount || ''}" />
          </div>
          <div class="form-group">
            <label>Coupon Label</label>
            <input class="form-control" id="approve-coupon-code" value="${entryRaw.couponCode || ''}" placeholder="e.g. Ibotta" />
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Date</label>
        <input class="form-control" type="date" id="approve-date" value="${new Date(entryRaw.date).toISOString().slice(0,10)}" />
      </div>
      <div class="form-group">
        <label>Notes</label>
        <input class="form-control" id="approve-notes" value="${entryRaw.notes || ''}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Approve</button>
      </div>
    </form>`;

  openModal('Edit & Approve', bodyHTML);

  document.getElementById('approve-sale').addEventListener('change', (e) => {
    document.getElementById('approve-sale-group').style.display = e.target.checked ? '' : 'none';
  });
  document.getElementById('approve-coupon').addEventListener('change', (e) => {
    document.getElementById('approve-coupon-group').style.display = e.target.checked ? '' : 'none';
  });

  document.getElementById('approve-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saleOn = document.getElementById('approve-sale').checked;
    const couponOn = document.getElementById('approve-coupon').checked;
    try {
      await api.prices.approve(id, {
        regularPrice: parseFloat(document.getElementById('approve-reg-price').value),
        quantity: parseFloat(document.getElementById('approve-qty').value),
        salePrice: saleOn ? (parseFloat(document.getElementById('approve-sale-price').value) || null) : null,
        couponAmount: couponOn ? (parseFloat(document.getElementById('approve-coupon-amount').value) || null) : null,
        couponCode: couponOn ? document.getElementById('approve-coupon-code').value.trim() : null,
        date: document.getElementById('approve-date').value,
        notes: document.getElementById('approve-notes').value.trim()
      });
      closeModal();
      showToast('Entry approved');
      if (onSuccess) await onSuccess();
    } catch (err) {
      handleError(err, 'Failed to approve entry');
    }
  });
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
