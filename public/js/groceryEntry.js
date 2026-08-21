// Unified grocery-entry experience.
// Replaces the older price modal so an item/store and its price can be captured
// without leaving the form or losing partially entered data.
(function initGroceryEntry() {
  function localDateValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function categoryOptions() {
    return `
      <option value="Produce"/><option value="Dairy"/><option value="Meat & Seafood"/>
      <option value="Bakery"/><option value="Pantry"/><option value="Frozen"/>
      <option value="Beverages"/><option value="Snacks"/><option value="Condiments & Sauces"/>
      <option value="Cleaning & Household"/>`;
  }

  function unitOptions() {
    return `
      <option value="lb"/><option value="oz"/><option value="each"/><option value="fl oz"/>
      <option value="gal"/><option value="dozen"/><option value="pack"/><option value="count"/>
      <option value="loaf"/><option value="bunch"/><option value="pint"/><option value="roll"/>`;
  }

  function setSelectedItem(item) {
    document.getElementById('price-item-input').value = item.name;
    document.getElementById('price-item-id').value = item._id;
    document.getElementById('price-item-unit').value = item.unit || '';
    const newItemPanel = document.getElementById('price-new-item');
    if (newItemPanel) newItemPanel.style.display = 'none';
    document.getElementById('price-new-item-mode').value = 'false';
    const ctx = document.getElementById('price-item-context');
    ctx.innerHTML = `${formatItemMeta(item)}${item.isOrganic ? ' <span class="badge badge-organic">Organic</span>' : ''}`;
    ctx.style.display = '';
    recalcPricePreview();
  }

  function startNewItem(name) {
    const input = document.getElementById('price-item-input');
    input.value = name;
    document.getElementById('price-item-id').value = '';
    document.getElementById('price-item-unit').value = '';
    document.getElementById('price-new-item-mode').value = 'true';
    const panel = document.getElementById('price-new-item');
    if (panel) panel.style.display = '';
    document.getElementById('price-item-context').style.display = 'none';
    document.getElementById('price-new-category')?.focus();
  }

  function setSelectedStore(store) {
    document.getElementById('price-store-input').value = store.name;
    document.getElementById('price-store-id').value = store._id;
    document.getElementById('price-new-store-mode').value = 'false';
    const panel = document.getElementById('price-new-store');
    if (panel) panel.style.display = 'none';
  }

  function startNewStore(name) {
    document.getElementById('price-store-input').value = name;
    document.getElementById('price-store-id').value = '';
    document.getElementById('price-new-store-mode').value = 'true';
    document.getElementById('price-new-store').style.display = '';
    document.getElementById('price-new-store-location')?.focus();
  }

  window.openAddPriceModal = function openUnifiedGroceryModal(prefillItem, onSaved) {
    const isAdmin = window.appAuth?.isAdmin();
    const submitLabel = isAdmin ? 'Save Grocery' : 'Submit for Review';
    const intro = isAdmin
      ? 'Pick an existing item, or create it here and record its first price in the same step.'
      : 'Pick an existing item and record what you paid. You can add a new store here if needed; new catalog items require an admin.';

    const bodyHTML = `
      <form id="add-price-form">
        <div class="callout-box" style="margin-bottom:0.75rem">${intro}</div>

        <div class="form-group">
          <label>What did you buy? <span class="required-star">*</span></label>
          <div class="autocomplete-wrap" style="display:flex;gap:0.375rem;align-items:flex-start">
            <div style="flex:1;position:relative">
              <input class="form-control" id="price-item-input" placeholder="Search items..." autocomplete="off"
                value="${prefillItem ? escapeAttr(prefillItem.name) : ''}" required />
              <div class="autocomplete-dropdown" id="price-item-dropdown"></div>
            </div>
            ${window.appAuth?.features?.barcodeScanning ? '<button type="button" id="price-scan-btn" class="btn-icon" title="Scan barcode">&#9638;</button>' : ''}
          </div>
          <input type="hidden" id="price-item-id" value="${prefillItem ? escapeAttr(prefillItem._id) : ''}" />
          <input type="hidden" id="price-item-unit" value="${prefillItem ? escapeAttr(prefillItem.unit || '') : ''}" />
          <input type="hidden" id="price-new-item-mode" value="false" />
          <div id="price-item-context" class="item-context" style="display:${prefillItem ? '' : 'none'}">
            ${prefillItem ? `${formatItemMeta(prefillItem)}${prefillItem.isOrganic ? ' <span class="badge badge-organic">Organic</span>' : ''}` : ''}
          </div>
        </div>

        ${isAdmin ? `
          <div id="price-new-item" class="callout-box" style="display:none;margin-bottom:0.75rem">
            <div style="font-weight:700;margin-bottom:0.5rem">New item details</div>
            <div class="form-group">
              <label>Brand <span class="text-muted text-sm">(optional)</span></label>
              <input class="form-control" id="price-new-brand" placeholder="e.g. Kirkland" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Category <span class="required-star">*</span></label>
                <input class="form-control" id="price-new-category" list="grocery-category-list" placeholder="e.g. Dairy" />
                <datalist id="grocery-category-list">${categoryOptions()}</datalist>
              </div>
              <div class="form-group">
                <label>Unit <span class="required-star">*</span></label>
                <input class="form-control" id="price-new-unit" list="grocery-unit-list" placeholder="e.g. lb, each" />
                <datalist id="grocery-unit-list">${unitOptions()}</datalist>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Size <span class="text-muted text-sm">(optional)</span></label>
                <input class="form-control" type="number" id="price-new-size" step="any" min="0" placeholder="e.g. 28" />
              </div>
              <div class="form-group" style="display:flex;align-items:center;gap:0.5rem;padding-top:1.6rem">
                <input type="checkbox" id="price-new-organic" />
                <label for="price-new-organic" style="margin:0">Organic</label>
              </div>
            </div>
          </div>` : ''}

        <div class="form-group">
          <label>Where did you buy it? <span class="required-star">*</span></label>
          <div class="autocomplete-wrap">
            <input class="form-control" id="price-store-input" placeholder="Search or add a store..." autocomplete="off" required />
            <div class="autocomplete-dropdown" id="price-store-dropdown"></div>
          </div>
          <input type="hidden" id="price-store-id" />
          <input type="hidden" id="price-new-store-mode" value="false" />
        </div>

        <div id="price-new-store" class="callout-box" style="display:none;margin-bottom:0.75rem">
          <div style="font-weight:700;margin-bottom:0.5rem">New store</div>
          <div class="form-group" style="margin-bottom:0">
            <label>Location <span class="text-muted text-sm">(optional)</span></label>
            <input class="form-control" id="price-new-store-location" placeholder="e.g. Main St" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Price paid ($) <span class="required-star">*</span></label>
            <input class="form-control" type="number" id="price-regular" step="0.01" min="0" required placeholder="0.00" inputmode="decimal" />
          </div>
          <div class="form-group">
            <label>Quantity <span class="required-star">*</span></label>
            <input class="form-control" type="number" id="price-qty" step="any" min="0.01" value="1" required inputmode="decimal" />
          </div>
        </div>
        <div class="form-group">
          <label>Date</label>
          <input class="form-control" type="date" id="price-date" value="${localDateValue()}" required />
        </div>

        <details style="margin-bottom:0.75rem">
          <summary style="cursor:pointer;font-weight:600">Sale, coupon & notes</summary>
          <div style="padding-top:0.65rem">
            <div class="checkbox-row">
              <input type="checkbox" id="price-on-sale" />
              <label for="price-on-sale">On sale</label>
            </div>
            <div class="form-group" id="price-sale-group" style="display:none">
              <label>Sale price ($)</label>
              <input class="form-control" type="number" id="price-sale" step="0.01" min="0" inputmode="decimal" />
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="price-coupon-used" />
              <label for="price-coupon-used">Used coupon</label>
            </div>
            <div id="price-coupon-group" style="display:none">
              <div class="form-row">
                <div class="form-group">
                  <label>Coupon amount ($)</label>
                  <input class="form-control" type="number" id="price-coupon-amount" step="0.01" min="0" inputmode="decimal" />
                </div>
                <div class="form-group">
                  <label>Coupon label</label>
                  <input class="form-control" id="price-coupon-code" placeholder="e.g. Ibotta" />
                </div>
              </div>
            </div>
            <div class="form-group">
              <label>Notes</label>
              <input class="form-control" id="price-notes" placeholder="Optional" />
            </div>
          </div>
        </details>

        <div id="price-calc-preview" class="price-calc-preview price-calc-placeholder">Enter a price above to see the final calculation</div>
        ${!isAdmin ? '<div class="callout-box" style="margin:0.75rem 0">Your entry will be pending admin review.</div>' : ''}

        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${submitLabel}</button>
        </div>
      </form>`;

    openModal(isAdmin ? 'Add Grocery' : 'Submit Grocery Price', bodyHTML);
    registerDirtyForm(() => document.getElementById('add-price-form')?.requestSubmit());

    document.getElementById('price-on-sale').addEventListener('change', event => {
      document.getElementById('price-sale-group').style.display = event.target.checked ? '' : 'none';
      recalcPricePreview();
    });
    document.getElementById('price-coupon-used').addEventListener('change', event => {
      document.getElementById('price-coupon-group').style.display = event.target.checked ? '' : 'none';
      recalcPricePreview();
    });
    ['price-regular', 'price-sale', 'price-coupon-amount', 'price-qty'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', recalcPricePreview);
    });

    const itemInput = document.getElementById('price-item-input');
    let selectedItemName = prefillItem?.name || '';
    attachItemAutocomplete(itemInput, document.getElementById('price-item-dropdown'), {
      onSelect(item) {
        selectedItemName = item.name;
        setSelectedItem(item);
      },
      onCreateNew: isAdmin ? name => {
        selectedItemName = '';
        startNewItem(name);
      } : null
    });
    itemInput.addEventListener('input', () => {
      if (document.getElementById('price-new-item-mode').value === 'true') return;
      if (selectedItemName && itemInput.value !== selectedItemName) {
        document.getElementById('price-item-id').value = '';
        document.getElementById('price-item-context').style.display = 'none';
      }
    });
    document.getElementById('price-new-unit')?.addEventListener('input', event => {
      document.getElementById('price-item-unit').value = event.target.value.trim();
      recalcPricePreview();
    });

    const storeInput = document.getElementById('price-store-input');
    let selectedStoreName = '';
    attachStoreAutocomplete(storeInput, document.getElementById('price-store-dropdown'), {
      onSelect(store) {
        selectedStoreName = store.name;
        setSelectedStore(store);
      },
      onCreateNew: name => {
        selectedStoreName = '';
        startNewStore(name);
      }
    });
    storeInput.addEventListener('input', () => {
      if (document.getElementById('price-new-store-mode').value === 'true') return;
      if (selectedStoreName && storeInput.value !== selectedStoreName) {
        document.getElementById('price-store-id').value = '';
      }
    });

    const scanBtn = document.getElementById('price-scan-btn');
    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        if (!window.BarcodeScanner) return showToast('Scanner unavailable. Try reloading the page.', 3000);
        BarcodeScanner.open(async upc => {
          if (!upc) return;
          await handleBarcodeResult(upc, item => {
            selectedItemName = item.name;
            setSelectedItem(item);
          });
        });
      });
    }

    document.getElementById('add-price-form').addEventListener('submit', async event => {
      event.preventDefault();
      const itemId = document.getElementById('price-item-id').value;
      const storeId = document.getElementById('price-store-id').value;
      const newItemMode = document.getElementById('price-new-item-mode').value === 'true';
      const newStoreMode = document.getElementById('price-new-store-mode').value === 'true';

      if (!itemId && !newItemMode) return showToast(isAdmin ? 'Select an item or choose Create' : 'Please select an item from the list');
      if (!storeId && !newStoreMode) return showToast('Select a store or choose Add store');

      const payload = {
        regularPrice: Number(document.getElementById('price-regular').value),
        quantity: Number(document.getElementById('price-qty').value),
        date: document.getElementById('price-date').value,
        notes: document.getElementById('price-notes').value.trim(),
        source: 'manual',
        salePrice: document.getElementById('price-on-sale').checked
          ? (document.getElementById('price-sale').value || null) : null,
        couponAmount: document.getElementById('price-coupon-used').checked
          ? (document.getElementById('price-coupon-amount').value || null) : null,
        couponCode: document.getElementById('price-coupon-used').checked
          ? document.getElementById('price-coupon-code').value.trim() : null
      };

      if (itemId) {
        payload.itemId = itemId;
      } else {
        const category = document.getElementById('price-new-category').value.trim();
        const unit = document.getElementById('price-new-unit').value.trim();
        if (!category || !unit) return showToast('Category and unit are required for a new item');
        payload.item = {
          name: itemInput.value.trim(),
          brand: document.getElementById('price-new-brand').value.trim(),
          category,
          unit,
          size: document.getElementById('price-new-size').value || null,
          isOrganic: document.getElementById('price-new-organic').checked
        };
      }

      if (storeId) {
        payload.storeId = storeId;
      } else {
        payload.store = {
          name: storeInput.value.trim(),
          location: document.getElementById('price-new-store-location').value.trim()
        };
      }

      const submit = event.target.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = 'Saving…';
      try {
        const result = await api.grocery.log(payload);
        closeModal();
        window.onWizardActionComplete?.('add-price');
        if (onSaved) {
          onSaved(result.entry);
        } else if (result.entry.status === 'pending') {
          const storeNote = result.createdStore ? ` Added ${result.createdStore.name} to your stores.` : '';
          showToast(`Submitted for review.${storeNote}`);
        } else {
          const created = result.createdItem ? ` Added ${result.createdItem.name} to the catalog.` : '';
          showToast(`Grocery saved.${created}`);
          await loadPricesTab();
        }
      } catch (err) {
        handleError(err, 'Failed to save grocery');
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    });

    if (prefillItem) recalcPricePreview();
  };
})();