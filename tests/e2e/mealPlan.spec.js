const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

test.describe('Meal Plan Tab', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
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

    const audienceButtons = dayCard.locator('.meal-audience-toggle');
    await expect(audienceButtons).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(audienceButtons.nth(i)).toHaveText('Change who');
    }
  });

  test('meal rows include an optional notes field', async ({ page }) => {
    const firstRow = page.locator('.meal-row').first();
    await expect(firstRow.locator('.meal-name-input')).toBeVisible();
    await expect(firstRow.locator('.meal-notes-input')).toBeVisible();
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

    const firstRow = page.locator('.meal-row').first();
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
    await page.locator('.meal-name-input').first().fill('Tacos');
    await expect(page.locator('#mp-save-status')).toHaveText('Saving…');
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓', { timeout: 10000 });
  });

  test('a separate meal starts with a real household audience', async ({ page }) => {
    const firstSection = page.locator('.meal-day').first().locator('.meal-type-section').first();
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
});
