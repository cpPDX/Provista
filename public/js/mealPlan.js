// Meal Plan Module

const mealPlanState = {
  weekStart: null,       // ISO date string YYYY-MM-DD
  weekStartDay: 6,       // 0=Sun, 1=Mon, 6=Sat
  mealPlanMode: 'dinner', // dinner | all
  people: [],            // active household people (accounts + non-account people)
  plan: null,
  favorites: null,
  saveTimer: null
};

// ===== Date helpers =====

function normalizeToWeekStart(date, weekStartDay) {
  const d = new Date(date);
  const dow = d.getDay();
  let diff = dow - weekStartDay;
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() - diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoToLocalDate(isoStr) {
  const s = isoStr.slice(0, 10);
  const [y, mo, d] = s.split('-').map(Number);
  return new Date(y, mo - 1, d);
}

function formatWeekRange(weekStartStr) {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const start = isoToLocalDate(weekStartStr);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = d => `${DAY_NAMES[d.getDay()]} ${MON_NAMES[d.getMonth()]} ${d.getDate()}`;
  return `${fmt(start)} — ${fmt(end)}`;
}

function formatDayHeader(dateVal) {
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = typeof dateVal === 'string' ? isoToLocalDate(dateVal) : new Date(dateVal);
  return `${DAY_NAMES[d.getDay()]} ${MON_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function addWeeks(weekStartStr, delta) {
  const d = isoToLocalDate(weekStartStr);
  d.setDate(d.getDate() + delta * 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ===== API helpers =====

async function fetchMealPlan(weekStart) {
  const res = await fetch(`/api/meal-plan?weekStart=${weekStart}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load meal plan');
  return res.json();
}

async function saveMealPlan(payload) {
  const res = await fetch('/api/meal-plan', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to save meal plan');
  return res.json();
}

async function fetchSettings() {
  const res = await fetch('/api/meal-plan/settings', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Failed to load settings');
  return res.json();
}

// ===== Meal shopping needs =====

function countMealShoppingFragments(notes) {
  const seen = new Set();
  String(notes || '').slice(0, 2000).split(/[\n,;]+/).forEach(raw => {
    const cleaned = raw
      .replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '')
      .replace(/^\s*(?:and|&)\s+/i, '')
      .replace(/^(?:(?:please|we)\s+)?(?:need(?:\s+to\s+(?:buy|get))?|buy|get|grab|pick\s*up|add|restock|check\s+(?:the\s+)?pantry\s+for)\s+/i, '')
      .trim()
      .toLowerCase();
    if (cleaned) seen.add(cleaned);
  });
  return Math.min(seen.size, 25);
}

function refreshMealShoppingAction(row) {
  const button = row.querySelector('.meal-list-suggestions-btn');
  const notes = row.querySelector('.meal-notes-input')?.value || '';
  const count = countMealShoppingFragments(notes);
  if (!button) return;
  button.hidden = count === 0;
  button.textContent = count === 1 ? 'Check 1 shopping need' : `Check ${count} shopping needs`;
}

function suggestionStatusHtml(item, duplicateInNotes = false) {
  if (duplicateInNotes) return '<span class="badge badge-no-data">Duplicate need</span>';
  if (item?.onList) return '<span class="badge badge-no-data">Already on List</span>';

  if (!item?.pantryTrackingMode) {
    return '<span class="badge badge-no-data">Not in Pantry</span>';
  }

  if (item.pantryTrackingMode === 'simple') {
    const label = { have: 'Have', low: 'Running low', out: 'Out' }[item.pantryStatus] || 'Not tracked';
    return `<span class="badge badge-no-data">Pantry: ${label}</span>`;
  }

  const onHand = Number(item.pantryQuantity) || 0;
  const projected = Number(item.projectedQuantity) || 0;
  const threshold = item.lowStockThreshold;
  const thresholdText = threshold == null ? '' : ` · low at ${threshold}`;
  const className = item.shoppingNeeded ? 'badge badge-no-data' : 'badge badge-muted';
  return `<span class="${className}">Pantry ${onHand} → ${projected} after meal${thresholdText}</span>`;
}

function mealSuggestionCandidateLabel(item) {
  let context = '';
  if (item.onList) {
    context = ' — already on List';
  } else if (item.pantryTrackingMode === 'simple') {
    const label = { have: 'Have', low: 'Running low', out: 'Out' }[item.pantryStatus] || 'not tracked';
    context = ` — Pantry: ${label}`;
  } else if (item.pantryTrackingMode === 'exact') {
    context = ` — Pantry ${item.pantryQuantity} → ${item.projectedQuantity} after meal`;
  } else {
    context = ' — not in Pantry';
  }
  return `${item.name}${item.brand ? ` (${item.brand})` : ''}${context}`;
}

function renderMealSuggestionRow(suggestion, index) {
  const quantity = Number(suggestion.quantity) || 1;
  if (suggestion.matchStatus === 'unmatched') {
    return `<div class="meal-suggestion-row" data-suggestion-index="${index}">
      <div class="meal-suggestion-source"><strong>${escapeHtml(suggestion.sourceText)}</strong>${quantity !== 1 ? ` <span class="text-muted">· meal qty ${quantity}</span>` : ''}</div>
      <div class="meal-suggestion-unmatched">
        <span>No catalog match.</span>
        <button type="button" class="btn-link meal-suggestion-create-btn"
          data-source-text="${escapeAttr(suggestion.sourceText)}" data-quantity="${escapeAttr(quantity)}">
          Add “${escapeHtml(suggestion.sourceText)}” with details
        </button>
      </div>
    </div>`;
  }

  if (suggestion.matchStatus === 'ambiguous') {
    const options = suggestion.candidates.map(item => `
      <option value="${escapeAttr(item._id)}"
        data-name="${escapeAttr(item.name)}"
        data-on-list="${item.onList ? 'true' : 'false'}"
        data-pantry-quantity="${escapeAttr(item.pantryQuantity || 0)}"
        data-pantry-tracking-mode="${escapeAttr(item.pantryTrackingMode || '')}"
        data-pantry-status="${escapeAttr(item.pantryStatus || '')}"
        data-projected-quantity="${escapeAttr(item.projectedQuantity ?? '')}"
        data-low-stock-threshold="${escapeAttr(item.lowStockThreshold ?? '')}"
        data-shopping-needed="${item.shoppingNeeded ? 'true' : 'false'}">
        ${escapeHtml(mealSuggestionCandidateLabel(item))}
      </option>`).join('');
    return `<div class="meal-suggestion-row" data-suggestion-index="${index}" data-quantity="${escapeAttr(quantity)}">
      <label class="meal-suggestion-choice">
        <input type="checkbox" class="meal-suggestion-check" disabled />
        <span><strong>${escapeHtml(suggestion.sourceText)}</strong>${quantity !== 1 ? ` <span class="text-muted">· meal qty ${quantity}</span>` : ''}</span>
      </label>
      <select class="form-control meal-suggestion-select" aria-label="Choose catalog item for ${escapeAttr(suggestion.sourceText)}">
        <option value="">Choose the household item…</option>
        ${options}
      </select>
      <div class="meal-suggestion-status"></div>
    </div>`;
  }

  const item = suggestion.item;
  const disabled = item.onList || suggestion.duplicateInNotes;
  const checked = !disabled && item.shoppingNeeded;
  return `<div class="meal-suggestion-row" data-suggestion-index="${index}" data-quantity="${escapeAttr(quantity)}">
    <label class="meal-suggestion-choice">
      <input type="checkbox" class="meal-suggestion-check"
        data-item-id="${escapeAttr(item._id)}" data-item-name="${escapeAttr(item.name)}"
        ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      <span><strong>${escapeHtml(item.name)}</strong>${quantity !== 1 ? ` <span class="text-muted">· meal qty ${quantity}</span>` : ''}
        ${suggestion.sourceText.toLowerCase() !== item.name.toLowerCase() ? `<small>From “${escapeHtml(suggestion.sourceText)}”</small>` : ''}
      </span>
    </label>
    <div class="meal-suggestion-status">${suggestionStatusHtml(item, suggestion.duplicateInNotes)}</div>
  </div>`;
}

async function openUnmatchedMealNeedDetails(button) {
  const sourceText = button?.dataset.sourceText?.trim() || '';
  const quantity = Math.max(1, Number(button?.dataset.quantity) || 1);
  if (!sourceText) return;

  button.disabled = true;
  try {
    closeModal();
    await switchTab('list');
    openAddListItemModal(sourceText);
    const quantityInput = document.getElementById('list-qty');
    if (quantityInput) quantityInput.value = String(quantity);
  } catch (err) {
    handleError(err, 'Failed to open shopping item details');
  }
}

function selectedMealSuggestionItems() {
  const selectedById = new Map();
  document.querySelectorAll('.meal-suggestion-row').forEach(row => {
    const checkbox = row.querySelector('.meal-suggestion-check');
    if (!checkbox?.checked || checkbox.disabled || !checkbox.dataset.itemId) return;
    const quantity = Number(row.dataset.quantity) || 1;
    const current = selectedById.get(checkbox.dataset.itemId);
    selectedById.set(checkbox.dataset.itemId, Math.max(current?.quantity || 0, quantity));
  });
  return [...selectedById].map(([itemId, quantity]) => ({ itemId, quantity }));
}

function updateMealSuggestionSubmit() {
  const items = selectedMealSuggestionItems();
  const button = document.getElementById('btn-add-meal-suggestions');
  if (!button) return;
  button.disabled = items.length === 0;
  button.textContent = items.length === 1
    ? 'Add 1 item to Shopping List'
    : `Add ${items.length} items to Shopping List`;
}

function bindMealSuggestionControls() {
  document.querySelectorAll('.meal-suggestion-select').forEach(select => {
    select.addEventListener('change', () => {
      const row = select.closest('.meal-suggestion-row');
      const checkbox = row.querySelector('.meal-suggestion-check');
      const status = row.querySelector('.meal-suggestion-status');
      const option = select.selectedOptions[0];
      if (!option?.value) {
        checkbox.checked = false;
        checkbox.disabled = true;
        delete checkbox.dataset.itemId;
        delete checkbox.dataset.itemName;
        status.innerHTML = '';
      } else {
        const item = {
          onList: option.dataset.onList === 'true',
          pantryQuantity: Number(option.dataset.pantryQuantity) || 0,
          pantryTrackingMode: option.dataset.pantryTrackingMode || null,
          pantryStatus: option.dataset.pantryStatus || null,
          projectedQuantity: option.dataset.projectedQuantity === '' ? null : Number(option.dataset.projectedQuantity),
          lowStockThreshold: option.dataset.lowStockThreshold === '' ? null : Number(option.dataset.lowStockThreshold),
          shoppingNeeded: option.dataset.shoppingNeeded === 'true'
        };
        checkbox.dataset.itemId = option.value;
        checkbox.dataset.itemName = option.dataset.name || '';
        checkbox.disabled = item.onList;
        checkbox.checked = !item.onList && item.shoppingNeeded;
        status.innerHTML = suggestionStatusHtml(item);
      }
      updateMealSuggestionSubmit();
    });
  });
  document.querySelectorAll('.meal-suggestion-check').forEach(checkbox => {
    checkbox.addEventListener('change', updateMealSuggestionSubmit);
  });
  document.querySelectorAll('.meal-suggestion-create-btn').forEach(button => {
    button.addEventListener('click', () => openUnmatchedMealNeedDetails(button));
  });
}

async function openMealShoppingSuggestions(row, triggerButton) {
  const notes = row.querySelector('.meal-notes-input')?.value.trim() || '';
  const mealName = row.querySelector('.meal-name-input')?.value.trim() || '';
  if (!notes) return;

  triggerButton.disabled = true;
  triggerButton.textContent = 'Checking Pantry & List…';
  try {
    const preview = await api.mealPlan.shoppingSuggestions(notes);
    if (!preview.parsedCount) {
      showToast('Separate shopping items with commas or new lines');
      return;
    }

    const rows = preview.suggestions.map(renderMealSuggestionRow).join('');
    openModal(mealName ? `Check shopping needs for ${mealName}` : 'Check meal shopping needs', `
      <p class="text-muted text-sm meal-suggestion-help">
        Provista compares the meal quantities with your Shopping List and Pantry. Exact tracking forecasts what would remain after the meal; Simple tracking uses Have, Running low, or Out. Planning does not deduct Pantry now—checked items are only added to the Shopping List.
      </p>
      <div class="meal-suggestion-list">${rows}</div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Done</button>
        <button type="button" class="btn btn-primary" id="btn-add-meal-suggestions">Add to Shopping List</button>
      </div>`);

    bindMealSuggestionControls();
    updateMealSuggestionSubmit();
    document.getElementById('btn-add-meal-suggestions')?.addEventListener('click', async event => {
      const items = selectedMealSuggestionItems();
      if (!items.length) return;
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Adding…';
      try {
        const result = await api.mealPlan.addShoppingSuggestions(items);
        closeModal();
        triggerButton.dataset.added = 'true';
        triggerButton.textContent = 'Shopping needs checked ✓';
        const skipped = result.skippedCount ? ` · ${result.skippedCount} already on List` : '';
        showToast(`Added ${result.addedCount} item${result.addedCount === 1 ? '' : 's'} to Shopping List${skipped}`);
      } catch (err) {
        handleError(err, 'Failed to add meal items');
        button.disabled = false;
        updateMealSuggestionSubmit();
      }
    });
  } catch (err) {
    handleError(err, 'Failed to check meal shopping needs');
  } finally {
    triggerButton.disabled = false;
    if (triggerButton.dataset.added !== 'true') refreshMealShoppingAction(row);
  }
}

// ===== Fast repetitive-week planning =====

function mealRowValue(row) {
  const forEveryone = row.dataset.forEveryone === 'true';
  return {
    name: row.querySelector('.meal-name-input')?.value.trim() || '',
    notes: row.querySelector('.meal-notes-input')?.value.trim() || '',
    forEveryone,
    personIds: forEveryone
      ? []
      : [...row.querySelectorAll('.meal-person-check:checked')].map(input => input.value),
    legacyPersonName: row.dataset.legacyPersonName || ''
  };
}

function applyMealValue(row, meal) {
  const nameInput = row.querySelector('.meal-name-input');
  const notesInput = row.querySelector('.meal-notes-input');
  if (nameInput) nameInput.value = meal.name || '';
  if (notesInput) notesInput.value = meal.notes || '';

  const everyone = meal.forEveryone !== false;
  row.dataset.forEveryone = everyone ? 'true' : 'false';
  row.dataset.legacyPersonName = everyone ? '' : (meal.legacyPersonName || '');
  const everyoneCheck = row.querySelector('.meal-everyone-check');
  if (everyoneCheck) everyoneCheck.checked = everyone;
  const selectedIds = new Set((meal.personIds || []).map(String));
  row.querySelectorAll('.meal-person-check').forEach(input => {
    input.disabled = everyone;
    input.checked = !everyone && selectedIds.has(input.value);
  });
  refreshAudienceUI(row);
  refreshMealShoppingAction(row);
  refreshMealRowActions(row);
}

function repeatMeal(row) {
  const meal = mealRowValue(row);
  if (!meal.name) return;
  const day = row.closest('.meal-day');
  const dayIndex = Number(day?.dataset.dayIndex);
  const mealType = row.closest('.meal-type-section')?.dataset.mealType;

  for (let index = dayIndex + 1; index < 7; index++) {
    const targetDay = document.querySelector(`.meal-day[data-day-index="${index}"]`);
    const targetSection = targetDay?.querySelector(`.meal-type-section[data-meal-type="${mealType}"]`);
    const targetRow = [...(targetSection?.querySelectorAll('.meal-row') || [])].find(candidate => {
      const target = mealRowValue(candidate);
      return !target.name && !target.notes;
    });
    if (!targetRow) continue;

    applyMealValue(targetRow, meal);
    expandMealTypeSection(targetSection);
    scheduleSave();
    const dayLabel = targetDay.querySelector('.meal-day-header')?.textContent || 'the next open day';
    showToast(`Repeated ${meal.name} on ${dayLabel}`);
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  showToast('No open day remains this week for that meal');
}

function refreshMealRowActions(row) {
  const hasMeal = Boolean(row.querySelector('.meal-name-input')?.value.trim());
  const repeatButton = row.querySelector('.meal-repeat-btn');
  if (repeatButton) repeatButton.disabled = !hasMeal;
}

function expandMealTypeSection(section) {
  const content = section?.querySelector('.meal-type-rows');
  const toggle = section?.querySelector('.meal-type-header[data-collapsed]');
  if (!content || !toggle) return;
  toggle.dataset.collapsed = 'false';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.textContent = `− ${section.dataset.mealLabel || ''}`;
  content.style.display = '';
  if (section.dataset.mealType === 'special') {
    section.closest('.meal-day').dataset.specialCollapsed = 'false';
  }
}

function setMealAsLeftovers(row) {
  const nameInput = row.querySelector('.meal-name-input');
  if (!nameInput) return;
  nameInput.value = 'Leftovers';
  const notesInput = row.querySelector('.meal-notes-input');
  if (notesInput) notesInput.value = '';
  const suggestionButton = row.querySelector('.meal-list-suggestions-btn');
  if (suggestionButton) delete suggestionButton.dataset.added;
  refreshMealShoppingAction(row);
  refreshMealRowActions(row);
  scheduleSave();
  showToast('This meal is now Leftovers');
}

async function loadMealFavorites(force = false) {
  if (!force && Array.isArray(mealPlanState.favorites)) return mealPlanState.favorites;
  mealPlanState.favorites = await api.mealPlan.favorites();
  return mealPlanState.favorites;
}

function favoriteMealCards(favorites) {
  if (!favorites.length) {
    return '<div class="empty-state meal-favorites-empty"><p>No favorite meals yet. Save the current meal to reuse its shopping needs next week.</p></div>';
  }
  return favorites.map(favorite => `
    <div class="meal-favorite-card" data-favorite-id="${escapeAttr(favorite._id)}">
      <div class="meal-favorite-copy">
        <strong>${escapeHtml(favorite.name)}</strong>
        ${favorite.notes ? `<small>${escapeHtml(favorite.notes)}</small>` : '<small>No saved shopping needs</small>'}
      </div>
      <div class="meal-favorite-actions">
        <button type="button" class="btn btn-primary btn-sm meal-favorite-use">Use</button>
        <button type="button" class="btn-link meal-favorite-remove" aria-label="Remove ${escapeAttr(favorite.name)} from favorites">Remove</button>
      </div>
    </div>`).join('');
}

async function openFavoritePicker(row) {
  try {
    const favorites = await loadMealFavorites();
    const current = mealRowValue(row);
    openModal('Favorite meals', `
      ${current.name ? `<button type="button" class="btn btn-outline btn-full" id="btn-save-current-favorite">☆ Save ${escapeHtml(current.name)} as favorite</button>` : ''}
      <div class="meal-favorites-list">${favoriteMealCards(favorites)}</div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Done</button>
      </div>`);

    document.getElementById('btn-save-current-favorite')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        await api.mealPlan.saveFavorite({ name: current.name, notes: current.notes });
        mealPlanState.favorites = null;
        closeModal();
        showToast(`${current.name} saved as a favorite`);
      } catch (err) {
        handleError(err, 'Failed to save favorite meal');
        button.disabled = false;
        button.textContent = `☆ Save ${current.name} as favorite`;
      }
    });

    document.querySelectorAll('.meal-favorite-use').forEach(button => {
      button.addEventListener('click', async () => {
        const id = button.closest('.meal-favorite-card').dataset.favoriteId;
        const favorite = favorites.find(entry => entry._id === id);
        if (!favorite) return;
        button.disabled = true;
        try {
          const used = await api.mealPlan.useFavorite(id);
          applyMealValue(row, {
            name: favorite.name,
            notes: favorite.notes || '',
            forEveryone: row.dataset.forEveryone === 'true',
            personIds: mealRowValue(row).personIds,
            legacyPersonName: row.dataset.legacyPersonName || ''
          });
          mealPlanState.favorites = favorites.map(entry => entry._id === id ? used : entry);
          closeModal();
          scheduleSave();
          showToast(`${favorite.name} added to the plan`);
        } catch (err) {
          handleError(err, 'Failed to use favorite meal');
          button.disabled = false;
        }
      });
    });

    document.querySelectorAll('.meal-favorite-remove').forEach(button => {
      button.addEventListener('click', async () => {
        const card = button.closest('.meal-favorite-card');
        const favorite = favorites.find(entry => entry._id === card.dataset.favoriteId);
        if (!favorite || !confirm(`Remove ${favorite.name} from favorite meals?`)) return;
        button.disabled = true;
        try {
          await api.mealPlan.deleteFavorite(favorite._id);
          mealPlanState.favorites = favorites.filter(entry => entry._id !== favorite._id);
          card.remove();
          if (!mealPlanState.favorites.length) {
            document.querySelector('.meal-favorites-list').innerHTML = favoriteMealCards([]);
          }
          showToast('Favorite removed');
        } catch (err) {
          handleError(err, 'Failed to remove favorite meal');
          button.disabled = false;
        }
      });
    });
  } catch (err) {
    handleError(err, 'Failed to load favorite meals');
  }
}

async function copyLastWeek() {
  const confirmed = await confirmAction({
    title: 'Replace this week with last week?',
    message: 'Meals and weekly notes from last week will be copied into this week. Existing entries in this week will be replaced.',
    confirmLabel: 'Copy last week',
    cancelLabel: 'Cancel',
    danger: false
  });
  if (!confirmed) return;

  const button = document.getElementById('mp-copy-last-week');
  if (button) { button.disabled = true; button.textContent = 'Copying…'; }
  if (mealPlanState.saveTimer) {
    clearTimeout(mealPlanState.saveTimer);
    mealPlanState.saveTimer = null;
  }
  try {
    const copied = await api.mealPlan.copyPrevious(mealPlanState.weekStart);
    mealPlanState.plan = copied;
    renderMealPlan({ ...copied, people: mealPlanState.people });
    showToast('Last week copied');
  } catch (err) {
    handleError(err, 'No meal plan found for last week');
    if (button) { button.disabled = false; button.textContent = 'Copy last week'; }
  }
}

// ===== Audience helpers =====

function findLegacyPersonId(personName) {
  if (!personName) return null;
  const normalized = personName.trim().toLowerCase();
  const first = normalized.split(/\s+/)[0];
  const match = mealPlanState.people.find(person => {
    const display = (person.displayName || '').trim().toLowerCase();
    return display === normalized || display === first;
  });
  return match?._id || null;
}

function normalizeMeal(meal = {}) {
  let personIds = Array.isArray(meal.personIds) ? meal.personIds.map(String) : [];
  let forEveryone = meal.forEveryone !== false;
  let legacyPersonName = meal.personName || '';

  // Migrate old personName rows into household-person references when possible.
  if (legacyPersonName && personIds.length === 0) {
    const matchId = findLegacyPersonId(legacyPersonName);
    if (matchId) {
      personIds = [String(matchId)];
      legacyPersonName = '';
    }
    forEveryone = false;
  }
  if (personIds.length) forEveryone = false;

  return {
    mealType: meal.mealType,
    name: meal.name || '',
    notes: meal.notes || '',
    forEveryone,
    personIds,
    legacyPersonName
  };
}

function getAudienceLabel(row) {
  if (row.dataset.forEveryone === 'true') return 'Everyone';
  const checked = [...row.querySelectorAll('.meal-person-check:checked')];
  if (checked.length) {
    return checked.map(input => {
      const person = mealPlanState.people.find(p => String(p._id) === input.value);
      return person?.displayName || 'Person';
    }).join(', ');
  }
  return row.dataset.legacyPersonName || 'Choose people';
}

function refreshAudienceUI(row) {
  const button = row.querySelector('.meal-audience-toggle');
  if (!button) return;
  const label = getAudienceLabel(row);
  button.textContent = `${label} · Change`;
  button.title = `${label} — change who this meal is for`;
  button.setAttribute('aria-label', `${label}. Change who this meal is for`);
  button.classList.toggle('meal-audience-default', label === 'Everyone');
}

function setEveryone(row, everyone) {
  row.dataset.forEveryone = everyone ? 'true' : 'false';
  const everyoneCheck = row.querySelector('.meal-everyone-check');
  const personChecks = [...row.querySelectorAll('.meal-person-check')];
  if (everyoneCheck) everyoneCheck.checked = everyone;
  personChecks.forEach(input => {
    input.disabled = everyone;
    if (everyone) input.checked = false;
  });
  if (everyone) row.dataset.legacyPersonName = '';
  refreshAudienceUI(row);
}

// ===== Collect current plan from DOM =====

function collectPlanFromDOM() {
  const days = [];
  document.querySelectorAll('.meal-day[data-day-index]').forEach(dayEl => {
    const dateVal = dayEl.dataset.date;
    const specialCollapsed = dayEl.dataset.specialCollapsed === 'true';
    const meals = [];

    dayEl.querySelectorAll('.meal-type-section[data-meal-type]').forEach(section => {
      const mealType = section.dataset.mealType;
      section.querySelectorAll('.meal-row').forEach(row => {
        const name = row.querySelector('.meal-name-input')?.value.trim() || '';
        const notes = row.querySelector('.meal-notes-input')?.value.trim() || '';
        const forEveryone = row.dataset.forEveryone === 'true';
        const personIds = forEveryone
          ? []
          : [...row.querySelectorAll('.meal-person-check:checked')].map(input => input.value);

        meals.push({
          mealType,
          name,
          notes,
          forEveryone,
          personIds,
          // Preserve an unmatched legacy name until the household people list can resolve it.
          personName: !forEveryone && personIds.length === 0 ? (row.dataset.legacyPersonName || '') : ''
        });
      });
    });
    days.push({ date: dateVal, meals, specialCollapsed });
  });

  return {
    weekStart: mealPlanState.weekStart,
    days,
    produceNotes: document.getElementById('mp-produce-notes')?.value ?? mealPlanState.plan?.produceNotes ?? '',
    // Weekly Shopping notes are no longer primary UI, but legacy content stays
    // round-trippable until a deliberate migration/removal decision is made.
    shoppingNotes: document.getElementById('mp-shopping-notes')?.value ?? mealPlanState.plan?.shoppingNotes ?? ''
  };
}

// ===== Save =====

function scheduleSave() {
  if (mealPlanState.saveTimer) clearTimeout(mealPlanState.saveTimer);
  setMealPlanSaveStatus('Saving…', 'saving');
  mealPlanState.saveTimer = setTimeout(doSave, 500);
}

function setMealPlanSaveStatus(message, state = '') {
  const status = document.getElementById('mp-save-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

async function doSave() {
  const payload = collectPlanFromDOM();
  try {
    const saved = await saveMealPlan(payload);
    mealPlanState.plan = saved;
    setMealPlanSaveStatus('Saved ✓', 'saved');
  } catch (err) {
    setMealPlanSaveStatus('Couldn’t save', 'error');
    if (typeof showToast === 'function') showToast('Failed to save meal plan');
  }
}

// ===== Meal row builders =====

function buildMealRow(mealType, rawMeal = {}, removable = false) {
  const meal = normalizeMeal(rawMeal);
  const row = document.createElement('div');
  row.className = 'meal-row';
  row.dataset.forEveryone = meal.forEveryone ? 'true' : 'false';
  row.dataset.legacyPersonName = meal.legacyPersonName || '';

  const top = document.createElement('div');
  top.style.display = 'grid';
  top.style.gridTemplateColumns = 'minmax(0,1fr) auto';
  top.style.gap = '0.5rem';
  top.style.alignItems = 'center';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'meal-name-input';
  nameInput.value = meal.name;
  nameInput.placeholder = 'Meal…';
  nameInput.addEventListener('input', () => {
    refreshMealRowActions(row);
    scheduleSave();
  });
  top.appendChild(nameInput);

  const audienceBtn = document.createElement('button');
  audienceBtn.type = 'button';
  audienceBtn.className = 'meal-audience-toggle btn btn-outline btn-sm';
  audienceBtn.setAttribute('aria-label', 'Choose who this meal is for');
  top.appendChild(audienceBtn);
  row.appendChild(top);

  const picker = document.createElement('div');
  picker.className = 'meal-person-picker';
  picker.style.display = 'none';
  picker.style.marginTop = '0.5rem';
  picker.style.padding = '0.5rem 0.625rem';
  picker.style.border = '1px solid var(--border)';
  picker.style.borderRadius = 'var(--radius-sm)';

  const everyoneLabel = document.createElement('label');
  everyoneLabel.style.display = 'flex';
  everyoneLabel.style.alignItems = 'center';
  everyoneLabel.style.gap = '0.5rem';
  everyoneLabel.style.marginBottom = mealPlanState.people.length ? '0.5rem' : '0';
  const everyoneCheck = document.createElement('input');
  everyoneCheck.type = 'checkbox';
  everyoneCheck.className = 'meal-everyone-check';
  everyoneCheck.checked = meal.forEveryone;
  everyoneLabel.appendChild(everyoneCheck);
  everyoneLabel.appendChild(document.createTextNode('Everyone'));
  picker.appendChild(everyoneLabel);

  mealPlanState.people.forEach(person => {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '0.5rem';
    label.style.padding = '0.2rem 0';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'meal-person-check';
    check.value = String(person._id);
    check.checked = meal.personIds.includes(String(person._id));
    check.disabled = meal.forEveryone;
    check.addEventListener('change', () => {
      row.dataset.forEveryone = 'false';
      everyoneCheck.checked = false;
      if (check.checked) row.dataset.legacyPersonName = '';
      refreshAudienceUI(row);
      scheduleSave();
    });

    label.appendChild(check);
    label.appendChild(document.createTextNode(person.displayName || 'Person'));
    picker.appendChild(label);
  });

  everyoneCheck.addEventListener('change', () => {
    setEveryone(row, everyoneCheck.checked);
    scheduleSave();
  });

  audienceBtn.addEventListener('click', () => {
    picker.style.display = picker.style.display === 'none' ? '' : 'none';
  });
  row.appendChild(picker);

  const needsLabel = document.createElement('div');
  needsLabel.className = 'meal-needs-label';
  needsLabel.textContent = 'Need for this meal';
  row.appendChild(needsLabel);

  const notesInput = document.createElement('textarea');
  notesInput.className = 'meal-notes-input meal-notes-area';
  notesInput.value = meal.notes;
  notesInput.placeholder = 'e.g. tortillas, salsa, cilantro';
  notesInput.setAttribute('aria-label', 'Need for this meal');
  notesInput.rows = 1;

  const suggestionButton = document.createElement('button');
  suggestionButton.type = 'button';
  suggestionButton.className = 'meal-list-suggestions-btn btn-link';
  notesInput.addEventListener('input', () => {
    delete suggestionButton.dataset.added;
    scheduleSave();
    refreshMealShoppingAction(row);
  });
  row.appendChild(notesInput);

  suggestionButton.addEventListener('click', () => openMealShoppingSuggestions(row, suggestionButton));
  const quickActions = document.createElement('div');
  quickActions.className = 'meal-row-quick-actions';
  quickActions.appendChild(suggestionButton);

  const repeatButton = document.createElement('button');
  repeatButton.type = 'button';
  repeatButton.className = 'meal-repeat-btn meal-row-action btn-link';
  const repeatTarget = mealType === 'special' ? 'special occasion' : mealType;
  repeatButton.textContent = `Repeat next ${repeatTarget}`;
  repeatButton.addEventListener('click', () => repeatMeal(row));
  quickActions.appendChild(repeatButton);

  const leftoversButton = document.createElement('button');
  leftoversButton.type = 'button';
  leftoversButton.className = 'meal-leftovers-btn meal-row-action btn-link';
  leftoversButton.textContent = 'Make this leftovers';
  leftoversButton.addEventListener('click', () => setMealAsLeftovers(row));
  quickActions.appendChild(leftoversButton);

  const favoritesButton = document.createElement('button');
  favoritesButton.type = 'button';
  favoritesButton.className = 'meal-favorites-btn meal-row-action btn-link';
  favoritesButton.textContent = 'Favorites';
  favoritesButton.addEventListener('click', () => openFavoritePicker(row));
  quickActions.appendChild(favoritesButton);
  row.appendChild(quickActions);
  refreshMealShoppingAction(row);
  refreshMealRowActions(row);

  if (removable) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'meal-row-remove';
    removeBtn.textContent = 'Remove separate meal';
    removeBtn.style.width = 'auto';
    removeBtn.style.fontSize = '0.75rem';
    removeBtn.style.marginTop = '0.375rem';
    removeBtn.setAttribute('aria-label', 'Remove separate meal');
    removeBtn.addEventListener('click', () => {
      if (!confirm('Remove this separate meal from the plan?')) return;
      row.remove();
      scheduleSave();
    });
    row.appendChild(removeBtn);
  }

  refreshAudienceUI(row);
  return row;
}

function buildAddMealButton(contentEl, mealType) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'meal-add-row';
  btn.textContent = '+ Add separate meal';
  btn.addEventListener('click', () => {
    if (!mealPlanState.people.length) {
      if (typeof showToast === 'function') showToast('Add a household person before creating a separate meal');
      return;
    }
    const firstPersonId = String(mealPlanState.people[0]._id);
    const row = buildMealRow(mealType, {
      mealType,
      forEveryone: false,
      personIds: [firstPersonId],
      name: '',
      notes: ''
    }, true);
    contentEl.insertBefore(row, btn);
    row.querySelector('.meal-name-input')?.focus();
    scheduleSave();
  });
  return btn;
}

function buildMealTypeSection(mealType, label, typeMeals, isSpecial, specialCollapsed) {
  const section = document.createElement('div');
  section.className = 'meal-type-section';
  section.dataset.mealType = mealType;
  section.dataset.mealLabel = label;
  section.hidden = mealPlanState.mealPlanMode === 'dinner' && mealType !== 'dinner';

  const contentEl = document.createElement('div');
  contentEl.className = 'meal-type-rows';

  const meals = typeMeals.length ? typeMeals : [{ mealType, forEveryone: true, personIds: [], name: '', notes: '' }];
  meals.forEach((meal, index) => contentEl.appendChild(buildMealRow(mealType, meal, index > 0)));
  contentEl.appendChild(buildAddMealButton(contentEl, mealType));

  const hasPlannedMeal = typeMeals.some(meal => String(meal.name || '').trim() || String(meal.notes || '').trim());
  const isCollapsedUnplannedType = !isSpecial && mealType !== 'dinner' && !hasPlannedMeal;
  if (isSpecial || isCollapsedUnplannedType) {
    const collapsed = isSpecial ? specialCollapsed : true;
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'meal-type-header meal-type-toggle';
    toggleBtn.dataset.collapsed = collapsed ? 'true' : 'false';
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggleBtn.textContent = (collapsed ? '+ ' : '− ') + label;
    contentEl.style.display = collapsed ? 'none' : '';
    toggleBtn.addEventListener('click', () => {
      const col = toggleBtn.dataset.collapsed === 'true';
      toggleBtn.dataset.collapsed = col ? 'false' : 'true';
      toggleBtn.setAttribute('aria-expanded', col ? 'true' : 'false');
      toggleBtn.textContent = (col ? '− ' : '+ ') + label;
      contentEl.style.display = col ? '' : 'none';
      if (isSpecial) {
        toggleBtn.closest('.meal-day').dataset.specialCollapsed = col ? 'false' : 'true';
        scheduleSave();
      }
    });
    section.appendChild(toggleBtn);
  } else {
    const header = document.createElement('div');
    header.className = 'meal-type-header';
    header.textContent = label;
    section.appendChild(header);
  }

  section.appendChild(contentEl);
  return section;
}

// ===== Render =====

function renderMealPlan(plan) {
  const container = document.getElementById('meal-plan-content');
  if (!container) return;

  const isAdmin = window.appAuth && (window.appAuth.isAdmin ? window.appAuth.isAdmin() : false);

  const html = `
    <div class="meal-plan">
      <div class="meal-plan-nav">
        <button class="btn btn-icon" id="mp-prev-week" aria-label="Previous week">&#8249;</button>
        <span class="meal-plan-week-label">${formatWeekRange(mealPlanState.weekStart)}</span>
        <button class="btn btn-icon" id="mp-next-week" aria-label="Next week">&#8250;</button>
      </div>

      <div class="meal-plan-tools">
        <button class="btn btn-outline" id="mp-copy-last-week">Copy last week</button>
        <span class="meal-plan-mode-summary">${mealPlanState.mealPlanMode === 'dinner' ? 'Dinner only' : 'All meals'}</span>
      </div>

      <div class="produce-section">
        <div class="section-label">🥦 Produce to use this week</div>
        <textarea class="meal-notes-area" id="mp-produce-notes" placeholder="e.g. spinach, zucchini, lemons..." rows="2">${escHtml(plan.produceNotes || '')}</textarea>
      </div>

      <div id="mp-days-container"></div>

      <div class="meal-plan-actions">
        <span class="meal-save-status" id="mp-save-status" role="status" aria-live="polite" data-state="saved">Saved ✓</span>
        <button class="btn btn-outline" id="mp-export-btn">Export to calendar</button>
        ${isAdmin ? `
          <button class="btn btn-outline btn-sm" id="mp-settings-btn" style="margin-left:auto;font-size:0.8125rem">Plan settings</button>
        ` : ''}
      </div>
    </div>`;

  container.innerHTML = html;

  const daysContainer = document.getElementById('mp-days-container');
  const todayKey = (() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  })();
  const todayIndex = (plan.days || []).findIndex(day => String(day.date || '').slice(0, 10) === todayKey);
  const emphasisStart = todayIndex >= 0 ? todayIndex : 0;
  const expandedIndexes = new Set([emphasisStart, emphasisStart + 1, emphasisStart + 2]);
  (plan.days || []).forEach((day, di) => {
    daysContainer.appendChild(renderDayCard(day, di, expandedIndexes.has(di)));
  });

  document.getElementById('mp-produce-notes')?.addEventListener('input', scheduleSave);

  document.getElementById('mp-prev-week')?.addEventListener('click', () => {
    mealPlanState.weekStart = addWeeks(mealPlanState.weekStart, -1);
    loadMealPlan();
  });
  document.getElementById('mp-next-week')?.addEventListener('click', () => {
    mealPlanState.weekStart = addWeeks(mealPlanState.weekStart, 1);
    loadMealPlan();
  });

  document.getElementById('mp-export-btn')?.addEventListener('click', exportWeekICS);
  document.getElementById('mp-copy-last-week')?.addEventListener('click', copyLastWeek);
  document.getElementById('mp-settings-btn')?.addEventListener('click', openWeekStartSettings);
}

function renderDayCard(day, di, expanded = true) {
  const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', special: 'Special Occasion' };
  const MEAL_TYPES_ORDER = ['breakfast', 'lunch', 'dinner', 'special'];
  const dateStr = day.date ? (typeof day.date === 'string' ? day.date : new Date(day.date).toISOString()) : null;
  const specialCollapsed = day.specialCollapsed !== false;

  const dayEl = document.createElement('div');
  dayEl.className = 'meal-day';
  dayEl.dataset.dayIndex = di;
  dayEl.dataset.date = dateStr || '';
  dayEl.dataset.specialCollapsed = specialCollapsed ? 'true' : 'false';
  dayEl.dataset.expanded = String(expanded);

  const content = document.createElement('div');
  content.className = 'meal-day-content';
  content.hidden = !expanded;

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'meal-day-header';
  header.setAttribute('aria-expanded', String(expanded));
  const label = document.createElement('span');
  label.textContent = dateStr ? formatDayHeader(dateStr) : `Day ${di + 1}`;
  const plannedNames = (day.meals || []).map(meal => String(meal.name || '').trim()).filter(Boolean);
  const summary = document.createElement('span');
  summary.className = 'meal-day-summary';
  summary.textContent = plannedNames.length ? plannedNames.slice(0, 2).join(' · ') : 'Not planned';
  const chevron = document.createElement('span');
  chevron.className = 'meal-day-chevron';
  chevron.textContent = expanded ? '−' : '+';
  header.append(label, summary, chevron);
  header.addEventListener('click', () => setMealDayExpanded(dayEl, dayEl.dataset.expanded !== 'true'));
  dayEl.appendChild(header);

  MEAL_TYPES_ORDER.forEach(mealType => {
    const typeMeals = (day.meals || []).filter(m => m.mealType === mealType);
    content.appendChild(buildMealTypeSection(
      mealType, MEAL_LABELS[mealType], typeMeals,
      mealType === 'special', specialCollapsed
    ));
  });
  dayEl.appendChild(content);

  return dayEl;
}

function setMealDayExpanded(dayEl, expanded) {
  if (!dayEl) return;
  dayEl.dataset.expanded = String(expanded);
  const content = dayEl.querySelector('.meal-day-content');
  const header = dayEl.querySelector('.meal-day-header');
  if (content) content.hidden = !expanded;
  header?.setAttribute('aria-expanded', String(expanded));
  const chevron = header?.querySelector('.meal-day-chevron');
  if (chevron) chevron.textContent = expanded ? '−' : '+';
}

function focusTodaysDinner() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const day = [...document.querySelectorAll('.meal-day[data-date]')]
    .find(element => element.dataset.date.slice(0, 10) === today);
  if (!day) return;
  setMealDayExpanded(day, true);
  const input = day.querySelector('.meal-type-section[data-meal-type="dinner"] .meal-name-input');
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  day.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  input?.focus({ preventScroll: true });
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeIcsText(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// ===== ICS Export =====

function exportWeekICS() {
  const MEAL_HOURS = { breakfast: '080000', lunch: '120000', dinner: '180000', special: '190000' };
  const MEAL_HOURS_END = { breakfast: '090000', lunch: '130000', dinner: '190000', special: '200000' };

  const events = [];
  document.querySelectorAll('.meal-day[data-day-index]').forEach(dayEl => {
    const dateStr = dayEl.dataset.date;
    if (!dateStr) return;
    const datePart = dateStr.slice(0, 10).replace(/-/g, '');

    dayEl.querySelectorAll('.meal-type-section[data-meal-type]').forEach(section => {
      const mealType = section.dataset.mealType;
      section.querySelectorAll('.meal-row').forEach(row => {
        const name = row.querySelector('.meal-name-input')?.value.trim() || '';
        if (!name) return;
        const notes = row.querySelector('.meal-notes-input')?.value.trim() || '';
        const audience = getAudienceLabel(row);
        const summary = audience === 'Everyone' ? name : `${audience}: ${name}`;
        const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}-${mealType}@grocerytracker`;
        const event = [
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTART:${datePart}T${MEAL_HOURS[mealType]}`,
          `DTEND:${datePart}T${MEAL_HOURS_END[mealType]}`,
          `SUMMARY:${escapeIcsText(summary)}`
        ];
        if (notes) event.push(`DESCRIPTION:${escapeIcsText(notes)}`);
        event.push('END:VEVENT');
        events.push(event.join('\r\n'));
      });
    });
  });

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Provista//MealPlan//EN',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meal-plan-${mealPlanState.weekStart}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== Settings =====

function openWeekStartSettings() {
  const current = mealPlanState.weekStartDay;
  const currentMode = mealPlanState.mealPlanMode;
  const options = [
    { value: 6, label: 'Saturday' },
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' }
  ];

  if (typeof openModal !== 'function') return;

  openModal('Plan settings', `
    <form id="meal-plan-settings-form">
      <div class="form-group">
        <label>Show by default</label>
        <select class="form-control" name="mealPlanMode">
          <option value="dinner" ${currentMode === 'dinner' ? 'selected' : ''}>Dinner only</option>
          <option value="all" ${currentMode === 'all' ? 'selected' : ''}>All meals</option>
        </select>
        <small class="text-muted">All meals keeps unplanned meal types collapsed until you open them.</small>
      </div>
      <div class="form-group">
        <label>Week starts on</label>
        <select class="form-control" name="weekStartDay">
          ${options.map(o => `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);

  document.getElementById('meal-plan-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const weekStartDay = parseInt(e.target.weekStartDay.value, 10);
    const mealPlanMode = e.target.mealPlanMode.value;
    const weekChanged = weekStartDay !== mealPlanState.weekStartDay;
    try {
      const res = await fetch('/api/meal-plan/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDay, mealPlanMode })
      });
      if (!res.ok) throw new Error('Failed to save settings');
      const saved = await res.json();
      mealPlanState.weekStartDay = saved.weekStartDay;
      mealPlanState.mealPlanMode = saved.mealPlanMode;
      if (weekChanged) mealPlanState.weekStart = normalizeToWeekStart(new Date(), saved.weekStartDay);
      if (typeof closeModal === 'function') closeModal();
      if (typeof showToast === 'function') showToast('Plan settings updated');
      await loadMealPlan();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to save plan settings');
    }
  });
}

// ===== Load / Init =====

async function loadMealPlan() {
  const container = document.getElementById('meal-plan-content');
  if (!container) return;
  container.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

  try {
    if (!mealPlanState._initialized) {
      const settings = await fetchSettings();
      mealPlanState.weekStartDay = settings.weekStartDay;
      mealPlanState.mealPlanMode = settings.mealPlanMode || 'dinner';
      mealPlanState._initialized = true;
    }

    if (!mealPlanState.weekStart) {
      mealPlanState.weekStart = normalizeToWeekStart(new Date(), mealPlanState.weekStartDay);
    }

    const plan = await fetchMealPlan(mealPlanState.weekStart);
    mealPlanState.people = plan.people || [];
    mealPlanState.plan = plan;
    renderMealPlan(plan);
  } catch (err) {
    if (container) container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Failed to load meal plan.</div>`;
  }
}

function initMealPlanSection() {
  mealPlanState._initialized = false;
  mealPlanState.weekStart = null;
  mealPlanState.people = [];
  mealPlanState.favorites = null;
  mealPlanState.mealPlanMode = 'dinner';
}