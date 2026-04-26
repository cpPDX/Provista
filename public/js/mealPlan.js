// Meal Plan Module

const mealPlanState = {
  weekStart: null,       // ISO date string YYYY-MM-DD
  weekStartDay: 6,       // 0=Sun, 1=Mon, 6=Sat
  members: [],           // household members array
  plan: null,            // current plan object
  saveTimer: null
};

// ===== Date helpers =====

function normalizeToWeekStart(date, weekStartDay) {
  const d = new Date(date);
  // Work in local date to determine day-of-week
  const dow = d.getDay(); // 0=Sun ... 6=Sat
  let diff = dow - weekStartDay;
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() - diff);
  // Return as YYYY-MM-DD using local year/month/day
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoToLocalDate(isoStr) {
  // Accept "YYYY-MM-DD" or full ISO; return a Date in local time at midnight
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

async function fetchHouseholdMembers() {
  const res = await fetch('/api/household', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Failed to load household');
  const data = await res.json();
  return data.members || [];
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
        const personInput = row.querySelector('.meal-person-input');
        const nameInput = row.querySelector('.meal-name-input');
        const personName = personInput ? personInput.value.trim() : '';
        const name = nameInput ? nameInput.value.trim() : '';
        meals.push({ mealType, personName, name });
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
  mealPlanState.saveTimer = setTimeout(doSave, 500);
}

async function doSave() {
  const payload = collectPlanFromDOM();
  try {
    const saved = await saveMealPlan(payload);
    mealPlanState.plan = saved;
  } catch (err) {
    if (typeof showToast === 'function') showToast('Failed to save meal plan');
  }
}

// ===== Per-person row builders =====

function buildPersonRow(mealType, personName, mealName) {
  const row = document.createElement('div');
  row.className = 'meal-row';

  const personInput = document.createElement('input');
  personInput.type = 'text';
  personInput.className = 'meal-person-input';
  personInput.value = personName;
  personInput.placeholder = 'Person';
  personInput.addEventListener('input', scheduleSave);
  row.appendChild(personInput);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'meal-name-input';
  nameInput.value = mealName;
  nameInput.placeholder = 'Meal…';
  nameInput.addEventListener('input', scheduleSave);
  row.appendChild(nameInput);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'meal-row-remove';
  removeBtn.textContent = '×';
  removeBtn.setAttribute('aria-label', 'Remove row');
  removeBtn.addEventListener('click', () => { row.remove(); scheduleSave(); });
  row.appendChild(removeBtn);

  return row;
}

function buildAddPersonButton(contentEl, mealType) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'meal-add-row';
  btn.textContent = '+ Add person';
  btn.addEventListener('click', () => {
    const row = buildPersonRow(mealType, '', '');
    contentEl.insertBefore(row, btn);
    row.querySelector('.meal-person-input')?.focus();
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

  // Render per-person rows
  typeMeals.forEach(m => contentEl.appendChild(buildPersonRow(mealType, m.personName || '', m.name || '')));
  contentEl.appendChild(buildAddPersonButton(contentEl, mealType));

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
        <button class="btn btn-primary" id="mp-save-btn">Save Plan</button>
        <button class="btn btn-outline" id="mp-export-btn">Export Week</button>
        ${isAdmin ? `
          <button class="btn btn-outline btn-sm" id="mp-settings-btn" style="margin-left:auto;font-size:0.8125rem">⚙ Week starts</button>
        ` : ''}
      </div>
    </div>`;

  container.innerHTML = html;

  // Render day cards
  const daysContainer = document.getElementById('mp-days-container');
  (plan.days || []).forEach((day, di) => {
    const dayEl = renderDayCard(day, di);
    daysContainer.appendChild(dayEl);
  });

  // Wire up textarea auto-save
  ['mp-produce-notes', 'mp-shopping-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', scheduleSave);
  });

  // Wire up nav buttons
  document.getElementById('mp-prev-week')?.addEventListener('click', () => {
    mealPlanState.weekStart = addWeeks(mealPlanState.weekStart, -1);
    loadMealPlan();
  });
  document.getElementById('mp-next-week')?.addEventListener('click', () => {
    mealPlanState.weekStart = addWeeks(mealPlanState.weekStart, 1);
    loadMealPlan();
  });

  // Save button
  document.getElementById('mp-save-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('mp-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    await doSave();
    if (btn) { btn.disabled = false; btn.textContent = 'Save Plan'; }
    if (typeof showToast === 'function') showToast('Meal plan saved');
  });

  // Export button
  document.getElementById('mp-export-btn')?.addEventListener('click', exportWeekICS);

  // Settings button
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
    const rows = typeMeals.length > 0 ? typeMeals : [{ personName: '', name: '' }];
    dayEl.appendChild(buildMealTypeSection(
      mealType, MEAL_LABELS[mealType], rows,
      mealType === 'special', specialCollapsed
    ));
  });

  return dayEl;
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
        const nameInput = row.querySelector('.meal-name-input');
        const name = (nameInput ? nameInput.value : '').trim();
        if (!name) return;
        const personInput = row.querySelector('.meal-person-input');
        const person = (personInput ? personInput.value.trim() : '');
        const summary = person ? `${person}: ${name}` : name;
        const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}-${mealType}@grocerytracker`;
        events.push([
          'BEGIN:VEVENT',
          `UID:${uid}`,
          `DTSTART:${datePart}T${MEAL_HOURS[mealType]}`,
          `DTEND:${datePart}T${MEAL_HOURS_END[mealType]}`,
          `SUMMARY:${summary}`,
          'DESCRIPTION:Meal plan export from GroceryTracker',
          'END:VEVENT'
        ].join('\r\n'));
      });
    });
  });

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GroceryTracker//MealPlan//EN',
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
      // Re-normalize current week to new start day
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
    // Load settings + members in parallel if not yet loaded
    if (!mealPlanState._initialized) {
      const [settings, members] = await Promise.all([fetchSettings(), fetchHouseholdMembers()]);
      mealPlanState.weekStartDay = settings.weekStartDay;
      mealPlanState.members = members;
      mealPlanState._initialized = true;
    }

    if (!mealPlanState.weekStart) {
      mealPlanState.weekStart = normalizeToWeekStart(new Date(), mealPlanState.weekStartDay);
    }

    const plan = await fetchMealPlan(mealPlanState.weekStart);
    mealPlanState.plan = plan;
    renderMealPlan(plan);
  } catch (err) {
    if (container) container.innerHTML = `<div class="empty-state" style="color:var(--danger)">Failed to load meal plan.</div>`;
  }
}

function initMealPlanSection() {
  // Reset so it re-fetches settings and current week on first open
  mealPlanState._initialized = false;
  mealPlanState.weekStart = null;
}
