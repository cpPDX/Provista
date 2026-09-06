const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const TIME_ZONE = 'America/Los_Angeles';
const RUN_ID = String(process.env.MARKETING_CAPTURE_RUN_ID || `local-${Date.now()}`)
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .slice(0, 80);
const OUTPUT_DIR = process.env.MARKETING_CAPTURE_OUTPUT_DIR
  || path.join(process.cwd(), 'tmp', 'marketing-capture', RUN_ID);
const EMAIL = `marketing-capture-${RUN_ID.toLowerCase()}@test.com`;
const PASSWORD = `Mc-${crypto.randomBytes(18).toString('base64url')}!`;
const HOUSEHOLD_NAME = `Marketing Capture ${RUN_ID}`;

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'special'];

function dateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

function localDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function addDays(dateString, amount) {
  const date = localDate(dateString);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function currentWeekStart() {
  const today = dateKey();
  const date = localDate(today);
  date.setDate(date.getDate() - date.getDay());
  return dateKey(date);
}

function blankWeek(weekStart) {
  return Array.from({ length: 7 }, (_, dayIndex) => ({
    date: `${addDays(weekStart, dayIndex)}T00:00:00.000Z`,
    specialCollapsed: true,
    meals: MEAL_TYPES.map(mealType => ({
      mealType,
      personName: '',
      personIds: [],
      forEveryone: true,
      name: '',
      notes: ''
    }))
  }));
}

function setDinner(days, dayIndex, name, notes = '') {
  const dinner = days[dayIndex].meals.find(meal => meal.mealType === 'dinner');
  dinner.name = name;
  dinner.notes = notes;
}

async function responseBody(response) {
  try {
    return await response.text();
  } catch {
    return '<unavailable>';
  }
}

async function requireOk(response, label) {
  if (!response.ok()) {
    throw new Error(`${label} failed (${response.status()}): ${await responseBody(response)}`);
  }
  return response;
}

async function ensureItem(page, name, category, unit = 'each') {
  const existingResponse = await requireOk(await page.request.get('/api/items'), 'Load catalog');
  const items = await existingResponse.json();
  const existing = items.find(item => String(item.name || '').toLowerCase() === name.toLowerCase());
  if (existing) return existing;

  const response = await requireOk(await page.request.post('/api/items', {
    data: { name, category, unit }
  }), `Create ${name}`);
  return response.json();
}

async function createPantry(page, item, data) {
  const response = await requireOk(await page.request.post('/api/inventory', {
    data: { itemId: item._id, unit: item.unit || 'each', ...data }
  }), `Track ${item.name}`);
  return response.json();
}

async function createListItem(page, item, quantity, storeId) {
  const response = await requireOk(await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity, storeId }
  }), `Add ${item.name} to List`);
  return response.json();
}

async function seedMarketingState(page) {
  await requireOk(await page.request.put('/api/auth/profile', {
    data: { theme: 'light' }
  }), 'Set light theme');

  const store = await (await requireOk(await page.request.post('/api/stores', {
    data: { name: 'Neighborhood Market' }
  }), 'Create marketing store')).json();

  const items = {};
  for (const [key, name, category, unit] of [
    ['milk', 'Milk', 'Dairy', 'gallon'],
    ['bananas', 'Bananas', 'Produce', 'each'],
    ['oliveOil', 'Olive oil', 'Pantry', 'bottle'],
    ['eggs', 'Eggs', 'Dairy', 'each'],
    ['peppers', 'Bell peppers', 'Produce', 'each'],
    ['beans', 'Black beans', 'Pantry', 'can'],
    ['tortillas', 'Tortillas', 'Pantry', 'each'],
    ['chicken', 'Chicken', 'Meat & Seafood', 'lb']
  ]) {
    items[key] = await ensureItem(page, name, category, unit);
  }

  await createPantry(page, items.milk, {
    trackingMode: 'simple',
    stockStatus: 'low'
  });
  await createPantry(page, items.bananas, {
    trackingMode: 'simple',
    stockStatus: 'out'
  });
  await createPantry(page, items.oliveOil, {
    trackingMode: 'simple',
    stockStatus: 'have'
  });
  await createPantry(page, items.eggs, {
    trackingMode: 'exact',
    quantity: 8,
    lowStockThreshold: 3
  });
  await createPantry(page, items.peppers, {
    trackingMode: 'exact',
    quantity: 4,
    lowStockThreshold: 1
  });
  await createPantry(page, items.beans, {
    trackingMode: 'exact',
    quantity: 5,
    lowStockThreshold: 2
  });
  await createPantry(page, items.tortillas, {
    trackingMode: 'exact',
    quantity: 8,
    lowStockThreshold: 2
  });

  await Promise.all([
    createListItem(page, items.bananas, 2, store._id),
    createListItem(page, items.milk, 1, store._id),
    createListItem(page, items.peppers, 3, store._id),
    createListItem(page, items.beans, 4, store._id),
    createListItem(page, items.tortillas, 2, store._id),
    createListItem(page, items.chicken, 2, store._id)
  ]);

  const weekStart = currentWeekStart();
  const today = dateKey();
  const todayIndex = Math.max(0, Math.min(6, Math.round((localDate(today) - localDate(weekStart)) / 86400000)));
  const days = blankWeek(weekStart);
  setDinner(days, todayIndex, 'Chicken fajita bowls', 'Bell peppers x2\nBlack beans x2\nTortillas x4\nChicken x2');
  if (todayIndex < 6) setDinner(days, todayIndex + 1, 'Taco night', 'Black beans x2\nTortillas x4');
  if (todayIndex < 5) setDinner(days, todayIndex + 2, 'Pasta night', 'Olive oil');

  await requireOk(await page.request.put('/api/meal-plan/settings', {
    data: { weekStartDay: 0, mealPlanMode: 'dinner' }
  }), 'Set meal plan mode');
  await requireOk(await page.request.put('/api/meal-plan', {
    data: { weekStart, days, produceNotes: '', shoppingNotes: '' }
  }), 'Seed meal plan');

  return { weekStart, today, todayIndex, store, items };
}

async function stabilize(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `
  });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
}

async function capture(page, filename) {
  await stabilize(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const target = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: target, fullPage: false, animations: 'disabled' });
}

async function loginDisposable(page) {
  return page.request.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD }
  });
}

async function cleanupDisposable(page) {
  let login = await loginDisposable(page);
  if (login.status() === 401) {
    return { householdDeleted: false, accountDeleted: false, accountMissing: true };
  }
  await requireOk(login, 'Reauthenticate disposable capture account');

  const session = await requireOk(await page.request.get('/api/auth/me'), 'Load disposable session');
  const current = await session.json();
  let householdDeleted = false;

  if (current.household?._id || current.user?.householdId) {
    await requireOk(await page.request.delete('/api/household', {
      data: { password: PASSWORD }
    }), 'Delete disposable marketing household');
    householdDeleted = true;
  }

  login = await loginDisposable(page);
  await requireOk(login, 'Reauthenticate disposable account after household cleanup');
  await requireOk(await page.request.delete('/api/auth/account', {
    data: { password: PASSWORD }
  }), 'Delete disposable marketing account');

  const verify = await loginDisposable(page);
  expect(verify.status(), 'Disposable account should be gone after capture').toBe(401);
  return { householdDeleted, accountDeleted: true, accountMissing: false };
}

test.describe('PRO-93 real marketing screenshots', () => {
  test('captures Home, Plan, List, and Pantry from a disposable staging household', async ({ page, baseURL }) => {
    await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    let primaryError = null;
    let cleanupResult = null;
    let seed = null;
    let registrationCompleted = false;

    try {
      const register = await page.request.post('/api/auth/register', {
        data: {
          name: 'Alex',
          email: EMAIL,
          password: PASSWORD,
          action: 'create',
          householdName: HOUSEHOLD_NAME
        }
      });
      await requireOk(register, 'Register disposable marketing household');
      registrationCompleted = true;

      seed = await seedMarketingState(page);

      await page.goto('/app');
      await expect(page.locator('#home-react-title')).toBeVisible();
      const dinnerCard = page.locator('.home-react-card', { hasText: 'What’s for dinner?' });
      await expect(dinnerCard).toContainText('Chicken fajita bowls');
      await expect(page.getByRole('button', { name: 'View tonight', exact: true })).toBeVisible();
      await expect(page.getByText('Milk', { exact: true }).first()).toBeVisible();
      await capture(page, 'home.png');

      await page.evaluate(context => {
        sessionStorage.setItem('provista-plan-context', JSON.stringify(context));
      }, { weekStart: seed.weekStart, date: seed.today, mealType: 'dinner', rowIndex: 0 });
      await page.goto('/app/plan');
      const focusedDay = page.locator(`.plan-focused-day[data-plan-day="${seed.todayIndex}"]`);
      await expect(focusedDay).toBeVisible();
      await expect(focusedDay.locator('input[data-meal-name="dinner-0"]')).toHaveValue('Chicken fajita bowls');
      await expect(page.locator('.plan-pantry-outlook summary')).toBeVisible();
      await capture(page, 'plan.png');

      await page.goto('/app/list');
      await expect(page.locator('#react-list-title')).toHaveText('Shopping list');
      const storeGroup = page.getByRole('region', { name: 'Suggested stop Neighborhood Market' });
      await expect(storeGroup).toBeVisible();
      await expect(storeGroup.locator('.react-list-section-group[data-section="Produce"]')).toContainText('Bell peppers');
      await expect(storeGroup.locator('.react-list-section-group[data-section="Dairy & Eggs"]')).toContainText('Milk');
      await expect(storeGroup.locator('.react-list-section-group[data-section="Pantry"]')).toContainText('Black beans');
      await expect(page.locator('.react-list-item', { hasText: 'Black beans' })).toContainText('Buy 4');
      await capture(page, 'list.png');

      await page.goto('/app/pantry');
      await expect(page.locator('#pantry-react-title')).toHaveText('Pantry');
      await expect(page.locator('.pantry-card', { hasText: 'Milk' })).toContainText('Running low');
      await expect(page.locator('.pantry-card', { hasText: 'Bananas' })).toContainText('Out');
      const eggs = page.locator('.pantry-card', { hasText: 'Eggs' });
      await expect(eggs).toHaveAttribute('data-tracking-mode', 'exact');
      await expect(eggs).toContainText('8');
      await expect(page.locator('.pantry-card', { hasText: 'Olive oil' })).toContainText('Have');
      await capture(page, 'pantry.png');
    } catch (error) {
      primaryError = error;
    }

    try {
      cleanupResult = await cleanupDisposable(page);
      if (registrationCompleted) {
        expect(cleanupResult.accountDeleted, 'Disposable account cleanup must complete').toBe(true);
      }
    } catch (cleanupError) {
      primaryError = primaryError
        ? new AggregateError([primaryError, cleanupError], `Capture failed and cleanup also failed for ${RUN_ID}`)
        : cleanupError;
    }

    if (primaryError) {
      console.error(`Marketing capture ${RUN_ID} failed. Synthetic household label: ${HOUSEHOLD_NAME}`);
      throw primaryError;
    }

    const required = ['home.png', 'plan.png', 'list.png', 'pantry.png'];
    for (const filename of required) {
      const stats = await fs.stat(path.join(OUTPUT_DIR, filename));
      expect(stats.size, `${filename} should contain captured image data`).toBeGreaterThan(10000);
    }

    const manifest = {
      runId: RUN_ID,
      capturedAt: new Date().toISOString(),
      target: baseURL,
      sourceSha: process.env.MARKETING_CAPTURE_SOURCE_SHA || null,
      viewport: { width: 390, height: 844, device: 'iPhone 13 / Chromium' },
      householdTimeZone: TIME_ZONE,
      screenshots: required,
      cleanup: cleanupResult
    };
    await fs.writeFile(path.join(OUTPUT_DIR, 'capture-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  });
});
