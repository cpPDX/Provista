// Receipt Scanning tab logic
// Uses Tesseract.js loaded from CDN (see app.js script injection)

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
    fileInput.value = ''; // reset so same file can be re-selected
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

  // Default today's date
  document.getElementById('scan-date').value = new Date().toISOString().slice(0, 10);
}

async function processReceiptFile(file) {
  // Show image preview
  const reader = new FileReader();
  reader.onload = (e) => {
    scanState.imageDataUrl = e.target.result;
    document.getElementById('scan-image').src = e.target.result;
    document.getElementById('scan-preview').style.display = '';
  };
  reader.readAsDataURL(file);

  // Show progress
  document.getElementById('scan-results').style.display = 'none';
  document.getElementById('scan-progress').style.display = '';

  try {
    const text = await runOCR(file);
    const parsed = parseReceiptText(text);
    scanState.parsedLines = parsed.lines;

    // Try to auto-fill store name
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
  // Dynamically load Tesseract.js if not already loaded
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

  // Try to extract date (various formats)
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(\w{3,9})\s+(\d{1,2})[,\s]+(\d{4})/
  ];
  for (const line of lines) {
    for (const pat of datePatterns) {
      const m = line.match(pat);
      if (m) {
        const d = new Date(m[0]);
        if (!isNaN(d.getTime())) {
          result.date = d.toISOString().slice(0, 10);
          break;
        }
      }
    }
    if (result.date) break;
  }

  // Heuristic: first non-empty line is often store name
  if (lines.length > 0 && lines[0].length < 40) {
    result.storeName = lines[0];
  }

  // Parse item lines: look for lines with a price at the end
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
            <label style="font-size:0.75rem;color:var(--text-muted)">Price ($)</label>
            <input class="form-control" type="number" step="0.01" min="0" id="scan-line-price-${i}" value="${line.price.toFixed(2)}" />
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label style="font-size:0.75rem;color:var(--text-muted)">Quantity</label>
            <input class="form-control" type="number" step="any" min="0.01" id="scan-line-qty-${i}" value="1" />
          </div>
        </div>
        <div class="checkbox-row" style="padding:0.25rem 0">
          <input type="checkbox" id="scan-line-sale-${i}" />
          <label for="scan-line-sale-${i}" style="font-size:var(--text-sm)">On sale</label>
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

    const price = parseFloat(document.getElementById(`scan-line-price-${i}`).value);
    const quantity = parseFloat(document.getElementById(`scan-line-qty-${i}`).value);
    const isOnSale = document.getElementById(`scan-line-sale-${i}`).checked;

    toSave.push({ itemId, storeId, price, quantity, isOnSale, date, source: 'receipt' });
  }

  if (!toSave.length) {
    showToast('No items to save');
    return;
  }

  if (!storeId) {
    showToast('Please select or add a store');
    return;
  }

  try {
    await Promise.all(toSave.map(entry => api.prices.create(entry)));
    showToast(`Saved ${toSave.length} price${toSave.length !== 1 ? 's' : ''} from receipt`);
    // Reset
    document.getElementById('scan-results').style.display = 'none';
    document.getElementById('scan-preview').style.display = 'none';
    scanState.parsedLines = [];
    storeInput.value = '';
    delete storeInput.dataset.storeId;
    // Refresh prices tab if visible
    if (document.getElementById('tab-prices').classList.contains('active')) {
      await loadPricesTab();
    }
  } catch (err) {
    handleError(err, 'Failed to save some items');
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
