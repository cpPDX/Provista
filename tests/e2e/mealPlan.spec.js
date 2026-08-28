const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'special'];
const TODAY_DAY = new Date().getDay();
// Household settings intentionally support the common Saturday, Sunday, and
// Monday week starts. Pick one that keeps today and the next two days inside
// the current test week instead of sending an unsupported setting on Tue-Fri.
const TEST_WEEK_START_DAY = [0, 1, 6].includes(TODAY_DAY) ? TODAY_DAY : 1;

function currentDayIndex() {
  return (new Date().getDay() - TEST_WEEK_START_DAY + 7) % 7;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentWeekStart(weekStartDay = TEST_WEEK_START_DAY) {
  const date = new Date();
  let offset = date.getDay() - weekStartDay;
  if (offset < 0) offset += 7;
  date.setDate(date.getDate() - offset);
  return dateKey(date);
}

function addDays(dateString, amount) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + amount);
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

function dinnerRow(page, dayIndex = currentDayIndex()) {
  return page.locator(`.meal-day[data-day-index="${dayIndex}"] .meal-type-section[data-meal-type="dinner"] .meal-row`).first();
}

test.describe('Meal Plan Tab', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);

    const settingsResponse = await page.request.put('/api/meal-plan/settings', {
      data: { weekStartDay: TEST_WEEK_START_DAY, mealPlanMode: 'dinner' }
    });
    expect(settingsResponse.ok()).toBeTruthy();

    const weekStart = currentWeekStart();
    const resetResponse = await page.request.put('/api/meal-plan', {
      data: {
        weekStart,
        days: blankWeek(weekStart),
        produceNotes: '',
        shoppingNotes: ''
      }
    });
    expect(resetResponse.ok()).toBeTruthy();

    await page.click('[data-tab="meal-plan"]');
    await page.waitForSelector('.meal-day', { timeout: 10000 });
  });

  test('Meal Plan tab panel becomes active', async ({ page }) => {
    await expect(page.locator('#tab-meal-plan')).toHaveClass(/active/);
  });

  test('week navigation buttons are visible', async ({ page }) => {
    await expect(page.locator('#mp-prev-week')).toBeVisible();
    await expect(page.locator('#mp-next-week')).toBeVisible();
  });

  test('meal plan content loads with seven day cards', async ({ page }) => {
    await expect(page.locator('#meal-plan-content')).toBeVisible();
    await expect(page.locator('.meal-day')).toHaveCount(7);
  });

  test('emphasizes today and the next two days while keeping later days collapsible', async ({ page }) => {
    const days = page.locator('.meal-day');
    const todayIndex = currentDayIndex();
    for (let index = todayIndex; index < todayIndex + 3; index++) {
      await expect(days.nth(index)).toHaveAttribute('data-expanded', 'true');
      await expect(days.nth(index).locator('.meal-day-content')).toBeVisible();
    }
    const collapsedIndex = todayIndex === 0 ? 3 : 0;
    await expect(days.nth(collapsedIndex)).toHaveAttribute('data-expanded', 'false');
    await expect(days.nth(collapsedIndex).locator('.meal-day-content')).toBeHidden();
    await days.nth(collapsedIndex).locator('.meal-day-header').click();
    await expect(days.nth(collapsedIndex).locator('.meal-day-content')).toBeVisible();
  });

  test('each day shows its current audience without opening the picker', async ({ page }) => {
    const dayCard = page.locator(`.meal-day[data-day-index="${currentDayIndex()}"]`);
    await expect(dayCard.locator('.meal-type-section')).toHaveCount(4);
    await expect(page.locator('.meal-plan-mode-summary')).toHaveText('Dinner only');
    await expect(dayCard.locator('.meal-type-section[data-meal-type="dinner"]')).toBeVisible();
    await expect(dayCard.locator('.meal-type-section[data-meal-type="breakfast"]')).toBeHidden();
    await expect(dayCard.locator('.meal-type-section[data-meal-type="lunch"]')).toBeHidden();
    await expect(dayCard.locator('.meal-type-section[data-meal-type="special"]')).toBeHidden();

    const audienceButtons = dayCard.locator('.meal-audience-toggle');
    await expect(audienceButtons).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(audienceButtons.nth(i)).toHaveText('Everyone · Change');
      await expect(audienceButtons.nth(i)).toHaveAttribute('aria-label', 'Everyone. Change who this meal is for');
    }
  });

  test('meal rows expose one explicit shopping-needs field', async ({ page }) => {
    const firstRow = dinnerRow(page);
    await expect(firstRow.locator('.meal-name-input')).toBeVisible();
    await expect(firstRow.locator('.meal-needs-label')).toHaveText('Need for this meal');
    await expect(firstRow.locator('.meal-notes-input')).toHaveAttribute('aria-label', 'Need for this meal');
    await expect(firstRow.locator('.meal-notes-input')).toHaveAttribute('placeholder', 'e.g. tortillas, salsa, cilantro');
    await expect(page.locator('#mp-shopping-notes')).toHaveCount(0);
    await expect(page.locator('#mp-export-btn')).toHaveText('Export to calendar');
  });

  test('hidden legacy weekly shopping notes survive normal autosave', async ({ page }) => {
    const weekStart = currentWeekStart();
    const seeded = await page.request.put('/api/meal-plan', {
      data: {
        weekStart,
        days: blankWeek(weekStart),
        produceNotes: '',
        shoppingNotes: 'Legacy note that must survive'
      }
    });
    expect(seeded.ok()).toBeTruthy();
    await page.click('[data-tab="home"]');
    await page.click('[data-tab="meal-plan"]');
    await page.waitForSelector('.meal-day');
    await expect(page.locator('#mp-shopping-notes')).toHaveCount(0);

    await dinnerRow(page).locator('.meal-name-input').fill('Autosave dinner');
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓', { timeout: 10000 });

    const savedResponse = await page.request.get(`/api/meal-plan?weekStart=${weekStart}`);
    expect(savedResponse.ok()).toBeTruthy();
    const saved = await savedResponse.json();
    expect(saved.shoppingNotes).toBe('Legacy note that must survive');
  });

  test('Plan settings can show all meals while leaving unplanned types collapsed', async ({ page }) => {
    await page.locator('#mp-settings-btn').click();
    await expect(page.locator('#modal-title')).toHaveText('Plan settings');
    await page.locator('select[name="mealPlanMode"]').selectOption('all');
    await page.locator('#modal-footer button[form="meal-plan-settings-form"]').click();

    await expect(page.locator('.meal-plan-mode-summary')).toHaveText('All meals');
    const breakfast = page.locator(`.meal-day[data-day-index="${currentDayIndex()}"]`)
      .locator('.meal-type-section[data-meal-type="breakfast"]');
    await expect(breakfast).toBeVisible();
    await expect(breakfast.locator('.meal-type-rows')).toBeHidden();
    await breakfast.locator('.meal-type-toggle').click();
    await expect(breakfast.locator('.meal-type-rows')).toBeVisible();
  });

  test('Repeat and Leftovers labels state their exact result', async ({ page }) => {
    const firstDinner = dinnerRow(page);
    await firstDinner.locator('.meal-name-input').fill('Tacos');
    await expect(firstDinner.locator('.meal-repeat-btn')).toHaveText('Repeat next dinner');
    await expect(firstDinner.locator('.meal-leftovers-btn')).toHaveText('Make this leftovers');
    await firstDinner.locator('.meal-repeat-btn').click();

    const nextDinner = dinnerRow(page, currentDayIndex() + 1);
    await expect(nextDinner.locator('.meal-name-input')).toHaveValue('Tacos');
    await nextDinner.locator('.meal-leftovers-btn').click();
    await expect(nextDinner.locator('.meal-name-input')).toHaveValue('Leftovers');
    await expect(page.locator('#toast')).toContainText('This meal is now Leftovers');
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓', { timeout: 10000 });
  });

  test('favorite meals remember their usual shopping needs', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const mealName = `Favorite Tacos ${suffix}`;
    const mealNotes = `tortillas ${suffix}, lettuce, salsa`;
    const firstDinner = dinnerRow(page);
    await firstDinner.locator('.meal-name-input').fill(mealName);
    await firstDinner.locator('.meal-notes-input').fill(mealNotes);
    await firstDinner.locator('.meal-favorites-btn').click();
    await page.locator('#btn-save-current-favorite').click();
    await expect(page.locator('#modal-overlay')).toBeHidden();

    await firstDinner.locator('.meal-name-input').fill('');
    await firstDinner.locator('.meal-notes-input').fill('');
    await firstDinner.locator('.meal-favorites-btn').click();
    const favorite = page.locator('.meal-favorite-card', { hasText: mealName });
    await expect(favorite).toContainText(mealNotes);
    await favorite.locator('.meal-favorite-use').click();

    await expect(firstDinner.locator('.meal-name-input')).toHaveValue(mealName);
    await expect(firstDinner.locator('.meal-notes-input')).toHaveValue(mealNotes);
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓', { timeout: 10000 });
  });

  test('checks meal quantities against Pantry thresholds before adding shopping needs', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const names = {
      covered: `Meal Covered ${suffix}`,
      threshold: `Meal Threshold ${suffix}`,
      listed: `Meal Listed ${suffix}`,
      missing: `Meal Missing ${suffix}`
    };
    const createItem = name => page.request.post('/api/items', {
      data: { name, category: 'Other', unit: 'each' }
    });
    const [coveredResponse, thresholdResponse, listedResponse, missingResponse] = await Promise.all([
      createItem(names.covered),
      createItem(names.threshold),
      createItem(names.listed),
      createItem(names.missing)
    ]);
    expect(coveredResponse.ok()).toBeTruthy();
    expect(thresholdResponse.ok()).toBeTruthy();
    expect(listedResponse.ok()).toBeTruthy();
    expect(missingResponse.ok()).toBeTruthy();
    const [coveredItem, thresholdItem, listedItem, missingItem] = await Promise.all([
      coveredResponse.json(),
      thresholdResponse.json(),
      listedResponse.json(),
      missingResponse.json()
    ]);

    const [coveredInventory, thresholdInventory, listSetupResponse] = await Promise.all([
      page.request.post('/api/inventory', {
        data: { itemId: coveredItem._id, trackingMode: 'exact', quantity: 5, lowStockThreshold: 1 }
      }),
      page.request.post('/api/inventory', {
        data: { itemId: thresholdItem._id, trackingMode: 'exact', quantity: 3, lowStockThreshold: 1 }
      }),
      page.request.post('/api/shopping-list', {
        data: { itemId: listedItem._id, quantity: 1 }
      })
    ]);
    expect(coveredInventory.ok()).toBeTruthy();
    expect(thresholdInventory.ok()).toBeTruthy();
    expect(listSetupResponse.ok()).toBeTruthy();

    const firstRow = dinnerRow(page);
    await firstRow.locator('.meal-name-input').fill('Tacos');
    await firstRow.locator('.meal-notes-input').fill(
      `${names.covered} x2, ${names.threshold} x2, ${names.listed}, ${names.missing}`
    );
    const suggestionButton = firstRow.locator('.meal-list-suggestions-btn');
    await expect(suggestionButton).toHaveText('Check 4 shopping needs');
    await suggestionButton.click();

    await expect(page.locator('#modal-title')).toHaveText('Check shopping needs for Tacos');
    await expect(page.locator('.meal-suggestion-help')).toContainText('Planning does not deduct Pantry now');

    const coveredRow = page.locator('.meal-suggestion-row', { hasText: names.covered });
    const thresholdRow = page.locator('.meal-suggestion-row', { hasText: names.threshold });
    const listedRow = page.locator('.meal-suggestion-row', { hasText: names.listed });
    const missingRow = page.locator('.meal-suggestion-row', { hasText: names.missing });

    await expect(coveredRow.locator('.meal-suggestion-status')).toContainText('Pantry 5 → 3 after meal · low at 1');
    await expect(coveredRow.locator('.meal-suggestion-check')).not.toBeChecked();
    await expect(thresholdRow.locator('.meal-suggestion-status')).toContainText('Pantry 3 → 1 after meal · low at 1');
    await expect(thresholdRow.locator('.meal-suggestion-check')).toBeChecked();
    await expect(listedRow.locator('.meal-suggestion-status')).toContainText('Already on List');
    await expect(listedRow.locator('.meal-suggestion-check')).toBeDisabled();
    await expect(missingRow.locator('.meal-suggestion-status')).toContainText('Not in Pantry');
    await expect(missingRow.locator('.meal-suggestion-check')).toBeChecked();
    await expect(page.locator('#btn-add-meal-suggestions')).toHaveText('Add 2 items to Shopping List');

    await page.locator('#btn-add-meal-suggestions').click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(suggestionButton).toHaveText('Shopping needs checked ✓');

    const listResponse = await page.request.get('/api/shopping-list');
    const list = await listResponse.json();
    const ids = list.map(entry => entry.itemId?._id);
    expect(ids.filter(id => id === listedItem._id)).toHaveLength(1);
    expect(ids.filter(id => id === thresholdItem._id)).toHaveLength(1);
    expect(ids.filter(id => id === missingItem._id)).toHaveLength(1);
    expect(ids).not.toContain(coveredItem._id);

    const inventoryResponse = await page.request.get('/api/inventory');
    const inventory = await inventoryResponse.json();
    const thresholdOnHand = inventory.find(entry => String(entry.itemId?._id || entry.itemId) === thresholdItem._id);
    expect(thresholdOnHand.quantity).toBe(3);
  });

  test('autosave has one clear passive status instead of a Save button', async ({ page }) => {
    await expect(page.locator('#mp-save-btn')).toHaveCount(0);
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓');
    await dinnerRow(page).locator('.meal-name-input').fill('Tacos');
    await expect(page.locator('#mp-save-status')).toHaveText('Saving…');
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓', { timeout: 10000 });
  });

  test('a separate meal starts with a real household audience', async ({ page }) => {
    const firstSection = page.locator(`.meal-day[data-day-index="${currentDayIndex()}"]`)
      .locator('.meal-type-section[data-meal-type="dinner"]');
    await firstSection.locator('.meal-add-row').click();
    await expect(firstSection.locator('.meal-row')).toHaveCount(2);
    const audience = firstSection.locator('.meal-row').nth(1).locator('.meal-audience-toggle');
    await expect(audience).toContainText('· Change');
    await expect(audience).not.toHaveText('Choose people · Change');
    await expect(audience).not.toHaveText('Everyone · Change');
  });

  test('prev/next week nav changes the week label', async ({ page }) => {
    const label = page.locator('.meal-plan-week-label');
    const beforeText = await label.textContent();
    await page.click('#mp-next-week');
    await page.waitForFunction(
      previous => document.querySelector('.meal-plan-week-label')?.textContent !== previous,
      beforeText
    );
    await expect(label).not.toHaveText(beforeText);
  });

  test('Copy last week uses shared confirmation and preserves hidden weekly notes', async ({ page }) => {
    const weekStart = currentWeekStart();
    const previousWeekStart = addDays(weekStart, -7);
    const previousDays = blankWeek(previousWeekStart);
    const previousDinner = previousDays[currentDayIndex()].meals.find(meal => meal.mealType === 'dinner');
    previousDinner.name = 'Last Week Tacos';
    previousDinner.notes = 'tortillas, lettuce, salsa';

    const setupResponse = await page.request.put('/api/meal-plan', {
      data: {
        weekStart: previousWeekStart,
        days: previousDays,
        produceNotes: 'Use the cilantro',
        shoppingNotes: 'Check the beans'
      }
    });
    expect(setupResponse.ok()).toBeTruthy();

    await page.locator('#mp-copy-last-week').click();
    const confirm = page.getByRole('dialog', { name: 'Replace this week with last week?' });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Existing entries in this week will be replaced.');
    await confirm.getByRole('button', { name: 'Copy last week' }).click();

    const firstDinner = dinnerRow(page);
    await expect(firstDinner.locator('.meal-name-input')).toHaveValue('Last Week Tacos');
    await expect(firstDinner.locator('.meal-notes-input')).toHaveValue('tortillas, lettuce, salsa');
    await expect(page.locator('#mp-produce-notes')).toHaveValue('Use the cilantro');
    await expect(page.locator('#mp-shopping-notes')).toHaveCount(0);

    const copiedResponse = await page.request.get(`/api/meal-plan?weekStart=${weekStart}`);
    expect(copiedResponse.ok()).toBeTruthy();
    const copied = await copiedResponse.json();
    expect(copied.shoppingNotes).toBe('Check the beans');
  });
});
