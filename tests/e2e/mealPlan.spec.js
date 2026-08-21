const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'special'];

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentWeekStart(weekStartDay = 6) {
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

function dinnerRow(page, dayIndex = 0) {
  return page.locator(`.meal-day[data-day-index="${dayIndex}"] .meal-type-section[data-meal-type="dinner"] .meal-row`).first();
}

test.describe('Meal Plan Tab', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);

    const settingsResponse = await page.request.put('/api/meal-plan/settings', {
      data: { weekStartDay: 6, mealPlanMode: 'dinner' }
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

  test('each day starts with four meal type sections and quiet default audiences', async ({ page }) => {
    const dayCard = page.locator('.meal-day').first();
    await expect(dayCard.locator('.meal-type-section')).toHaveCount(4);
    await expect(page.locator('.meal-plan-mode-summary')).toHaveText('Dinner only');
    await expect(dayCard.locator('.meal-type-section[data-meal-type="dinner"]')).toBeVisible();
    await expect(dayCard.locator('.meal-type-section[data-meal-type="breakfast"]')).toBeHidden();
    await expect(dayCard.locator('.meal-type-section[data-meal-type="lunch"]')).toBeHidden();
    await expect(dayCard.locator('.meal-type-section[data-meal-type="special"]')).toBeHidden();

    const audienceButtons = dayCard.locator('.meal-audience-toggle');
    await expect(audienceButtons).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(audienceButtons.nth(i)).toHaveText('Change who');
    }
  });

  test('meal rows include an optional notes field', async ({ page }) => {
    const firstRow = dinnerRow(page);
    await expect(firstRow.locator('.meal-name-input')).toBeVisible();
    await expect(firstRow.locator('.meal-notes-input')).toBeVisible();
  });

  test('Plan settings can show all meals while leaving unplanned types collapsed', async ({ page }) => {
    await page.locator('#mp-settings-btn').click();
    await expect(page.locator('#modal-title')).toHaveText('Plan settings');
    await page.locator('select[name="mealPlanMode"]').selectOption('all');
    await page.locator('#modal-footer button[form="meal-plan-settings-form"]').click();

    await expect(page.locator('.meal-plan-mode-summary')).toHaveText('All meals');
    const breakfast = page.locator('.meal-day').first()
      .locator('.meal-type-section[data-meal-type="breakfast"]');
    await expect(breakfast).toBeVisible();
    await expect(breakfast.locator('.meal-type-rows')).toBeHidden();
    await breakfast.locator('.meal-type-toggle').click();
    await expect(breakfast.locator('.meal-type-rows')).toBeVisible();
  });

  test('Repeat this meal and Leftovers fill the next dinner with one tap', async ({ page }) => {
    const firstDinner = dinnerRow(page);
    await firstDinner.locator('.meal-name-input').fill('Tacos');
    await firstDinner.locator('.meal-repeat-btn').click();

    const nextDinner = dinnerRow(page, 1);
    await expect(nextDinner.locator('.meal-name-input')).toHaveValue('Tacos');
    await nextDinner.locator('.meal-leftovers-btn').click();
    await expect(nextDinner.locator('.meal-name-input')).toHaveValue('Leftovers');
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓', { timeout: 10000 });
  });

  test('favorite meals remember their usual shopping notes', async ({ page }) => {
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

  test('meal notes preview List duplicates, flag Pantry, and add the remaining items', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const names = {
      pantry: `Meal Tortillas ${suffix}`,
      listed: `Meal Lettuce ${suffix}`,
      add: `Meal Salsa ${suffix}`
    };
    const createItem = name => page.request.post('/api/items', {
      data: { name, category: 'Other', unit: 'each' }
    });
    const [pantryResponse, listedResponse, addResponse] = await Promise.all([
      createItem(names.pantry),
      createItem(names.listed),
      createItem(names.add)
    ]);
    expect(pantryResponse.ok()).toBeTruthy();
    expect(listedResponse.ok()).toBeTruthy();
    expect(addResponse.ok()).toBeTruthy();
    const [pantryItem, listedItem, addItem] = await Promise.all([
      pantryResponse.json(),
      listedResponse.json(),
      addResponse.json()
    ]);
    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { itemId: pantryItem._id, quantity: 2 }
    });
    const listSetupResponse = await page.request.post('/api/shopping-list', {
      data: { itemId: listedItem._id, quantity: 1 }
    });
    expect(inventoryResponse.ok()).toBeTruthy();
    expect(listSetupResponse.ok()).toBeTruthy();

    const firstRow = dinnerRow(page);
    await firstRow.locator('.meal-name-input').fill('Tacos');
    await firstRow.locator('.meal-notes-input').fill(`Need ${names.pantry}, ${names.listed}, and ${names.add}`);
    const suggestionButton = firstRow.locator('.meal-list-suggestions-btn');
    await expect(suggestionButton).toHaveText('Add 3 items to List');
    await suggestionButton.click();

    await expect(page.locator('#modal-title')).toHaveText('Add items for Tacos');
    const pantryRow = page.locator('.meal-suggestion-row', { hasText: names.pantry });
    const listedRow = page.locator('.meal-suggestion-row', { hasText: names.listed });
    const addRow = page.locator('.meal-suggestion-row', { hasText: names.add });
    await expect(pantryRow.locator('.meal-suggestion-status')).toContainText('In Pantry');
    await expect(pantryRow.locator('.meal-suggestion-check')).not.toBeChecked();
    await expect(listedRow.locator('.meal-suggestion-status')).toContainText('Already on List');
    await expect(listedRow.locator('.meal-suggestion-check')).toBeDisabled();
    await expect(addRow.locator('.meal-suggestion-check')).toBeChecked();
    await expect(page.locator('#btn-add-meal-suggestions')).toHaveText('Add 1 to List');
    await page.locator('#btn-add-meal-suggestions').click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(suggestionButton).toHaveText('Added to List ✓');

    const listResponse = await page.request.get('/api/shopping-list');
    const list = await listResponse.json();
    const ids = list.map(entry => entry.itemId?._id);
    expect(ids.filter(id => id === listedItem._id)).toHaveLength(1);
    expect(ids.filter(id => id === addItem._id)).toHaveLength(1);
    expect(ids).not.toContain(pantryItem._id);

    const ownedEntries = list.filter(entry => [listedItem._id, addItem._id].includes(entry.itemId?._id));
    const cleanupResponses = await Promise.all(
      ownedEntries.map(entry => page.request.delete(`/api/shopping-list/${entry._id}`))
    );
    expect(cleanupResponses.every(response => response.ok())).toBeTruthy();
  });

  test('autosave has one clear passive status instead of a Save button', async ({ page }) => {
    await expect(page.locator('#mp-save-btn')).toHaveCount(0);
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓');
    await dinnerRow(page).locator('.meal-name-input').fill('Tacos');
    await expect(page.locator('#mp-save-status')).toHaveText('Saving…');
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓', { timeout: 10000 });
  });

  test('a separate meal starts with a real household audience', async ({ page }) => {
    const firstSection = page.locator('.meal-day').first()
      .locator('.meal-type-section[data-meal-type="dinner"]');
    await firstSection.locator('.meal-add-row').click();
    await expect(firstSection.locator('.meal-row')).toHaveCount(2);
    const audience = firstSection.locator('.meal-row').nth(1).locator('.meal-audience-toggle');
    await expect(audience).not.toHaveText('Choose people');
    await expect(audience).not.toHaveText('Everyone');
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

  test('Copy last week remaps meals and notes onto this week', async ({ page }) => {
    const weekStart = currentWeekStart();
    const previousWeekStart = addDays(weekStart, -7);
    const previousDays = blankWeek(previousWeekStart);
    const previousDinner = previousDays[0].meals.find(meal => meal.mealType === 'dinner');
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

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#mp-copy-last-week').click();

    const firstDinner = dinnerRow(page);
    await expect(firstDinner.locator('.meal-name-input')).toHaveValue('Last Week Tacos');
    await expect(firstDinner.locator('.meal-notes-input')).toHaveValue('tortillas, lettuce, salsa');
    await expect(page.locator('#mp-produce-notes')).toHaveValue('Use the cilantro');
    await expect(page.locator('#mp-shopping-notes')).toHaveValue('Check the beans');
  });
});
