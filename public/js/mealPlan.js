// Meal Plan Module

const mealPlanState = {
  weekStart: null,       // ISO date string YYYY-MM-DD
  weekStartDay: 6,       // 0=Sun, 1=Mon, 6=Sat
  people: [],            // active household people (accounts + non-account people)
  plan: null,
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
  button.textContent = label === 'Everyone' ? 'Change who' : label;
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
    produceNotes: document.getElementById('mp-produce-notes')?.value || '',
    shoppingNotes: document.getElementById('mp-shopping-notes')?.value || ''
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
  nameInput.addEventListener('input', scheduleSave);
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

  const notesInput = document.createElement('textarea');
  notesInput.className = 'meal-notes-input meal-notes-area';
  notesInput.value = meal.notes;
  notesInput.placeholder = 'Items needed or notes (optional)…';
  notesInput.rows = 1;
  notesInput.style.marginTop = '0.5rem';
  notesInput.addEventListener('input', scheduleSave);
  row.appendChild(notesInput);

  if (removable) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'meal-row-remove';
    removeBtn.textContent = 'Remove separate meal';
    removeBtn.style.width = 'auto';
    removeBtn.style.fontSize = '0.75rem';
    removeBtn.style.marginTop = '0.375rem';
    removeBtn.setAttribute('aria-label', 'Remove separate meal');
    removeBtn.addEventListener('click', () => { row.remove(); scheduleSave(); });
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

  const contentEl = document.createElement('div');
  contentEl.className = 'meal-type-rows';

  const meals = typeMeals.length ? typeMeals : [{ mealType, forEveryone: true, personIds: [], name: '', notes: '' }];
  meals.forEach((meal, index) => contentEl.appendChild(buildMealRow(mealType, meal, index > 0)));
  contentEl.appendChild(buildAddMealButton(contentEl, mealType));

  if (isSpecial) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'meal-type-header special-toggle';
    toggleBtn.dataset.collapsed = specialCollapsed ? 'true' : 'false';
    toggleBtn.textContent = (specialCollapsed ? '+ ' : '− ') + label;
    contentEl.style.display = specialCollapsed ? 'none' : '';
    toggleBtn.addEventListener('click', () => {
      const col = toggleBtn.dataset.collapsed === 'true';
      toggleBtn.dataset.collapsed = col ? 'false' : 'true';
      toggleBtn.closest('.meal-day').dataset.specialCollapsed = col ? 'false' : 'true';
      toggleBtn.textContent = (col ? '− ' : '+ ') + label;
      contentEl.style.display = col ? '' : 'none';
      scheduleSave();
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
        <button class="btn btn-icon" id="mp-prev-week">&#8249;</button>
        <span class="meal-plan-week-label">${formatWeekRange(mealPlanState.weekStart)}</span>
        <button class="btn btn-icon" id="mp-next-week">&#8250;</button>
      </div>

      <div class="produce-section">
        <div class="section-label">🥦 Produce to use this week</div>
        <textarea class="meal-notes-area" id="mp-produce-notes" placeholder="e.g. spinach, zucchini, lemons..." rows="2">${escHtml(plan.produceNotes || '')}</textarea>
      </div>

      <div id="mp-days-container"></div>

      <div class="shopping-notes-section">
        <div class="section-label">🛒 Shopping notes</div>
        <textarea class="meal-notes-area" id="mp-shopping-notes" placeholder="e.g. check pantry for pasta, need olive oil..." rows="2">${escHtml(plan.shoppingNotes || '')}</textarea>
      </div>

      <div class="meal-plan-actions">
        <span class="meal-save-status" id="mp-save-status" role="status" aria-live="polite" data-state="saved">Saved ✓</span>
        <button class="btn btn-outline" id="mp-export-btn">Export Week</button>
        ${isAdmin ? `
          <button class="btn btn-outline btn-sm" id="mp-settings-btn" style="margin-left:auto;font-size:0.8125rem">⚙ Week starts</button>
        ` : ''}
      </div>
    </div>`;

  container.innerHTML = html;

  const daysContainer = document.getElementById('mp-days-container');
  (plan.days || []).forEach((day, di) => daysContainer.appendChild(renderDayCard(day, di)));

  ['mp-produce-notes', 'mp-shopping-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', scheduleSave);
  });

  document.getElementById('mp-prev-week')?.addEventListener('click', () => {
    mealPlanState.weekStart = addWeeks(mealPlanState.weekStart, -1);
    loadMealPlan();
  });
  document.getElementById('mp-next-week')?.addEventListener('click', () => {
    mealPlanState.weekStart = addWeeks(mealPlanState.weekStart, 1);
    loadMealPlan();
  });

  document.getElementById('mp-export-btn')?.addEventListener('click', exportWeekICS);
  document.getElementById('mp-settings-btn')?.addEventListener('click', openWeekStartSettings);
}

function renderDayCard(day, di) {
  const MEAL_LABELS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', special: 'Special Occasion' };
  const MEAL_TYPES_ORDER = ['breakfast', 'lunch', 'dinner', 'special'];
  const dateStr = day.date ? (typeof day.date === 'string' ? day.date : new Date(day.date).toISOString()) : null;
  const specialCollapsed = day.specialCollapsed !== false;

  const dayEl = document.createElement('div');
  dayEl.className = 'meal-day';
  dayEl.dataset.dayIndex = di;
  dayEl.dataset.date = dateStr || '';
  dayEl.dataset.specialCollapsed = specialCollapsed ? 'true' : 'false';

  const header = document.createElement('div');
  header.className = 'meal-day-header';
  header.textContent = dateStr ? formatDayHeader(dateStr) : `Day ${di + 1}`;
  dayEl.appendChild(header);

  MEAL_TYPES_ORDER.forEach(mealType => {
    const typeMeals = (day.meals || []).filter(m => m.mealType === mealType);
    dayEl.appendChild(buildMealTypeSection(
      mealType, MEAL_LABELS[mealType], typeMeals,
      mealType === 'special', specialCollapsed
    ));
  });

  return dayEl;
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
  const options = [
    { value: 6, label: 'Saturday' },
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' }
  ];

  if (typeof openModal !== 'function') return;

  openModal('Week Start Day', `
    <form id="week-start-form">
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

  document.getElementById('week-start-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const weekStartDay = parseInt(e.target.weekStartDay.value, 10);
    try {
      const res = await fetch('/api/meal-plan/settings', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStartDay })
      });
      if (!res.ok) throw new Error('Failed to save settings');
      mealPlanState.weekStartDay = weekStartDay;
      mealPlanState.weekStart = normalizeToWeekStart(new Date(), weekStartDay);
      if (typeof closeModal === 'function') closeModal();
      if (typeof showToast === 'function') showToast('Week start day updated');
      await loadMealPlan();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to save settings');
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
}
