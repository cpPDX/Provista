const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

async function createDeferredPrice(page) {
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const storeResponse = await page.request.post('/api/stores', { data: { name: `Deferred Home Store ${suffix}` } });
  const itemResponse = await page.request.post('/api/items', {
    data: { name: `Deferred Home Item ${suffix}`, category: 'Other', unit: 'each' }
  });
  expect(storeResponse.ok()).toBeTruthy();
  expect(itemResponse.ok()).toBeTruthy();
  const store = await storeResponse.json();
  const item = await itemResponse.json();
  const listResponse = await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity: 1, storeId: store._id }
  });
  expect(listResponse.ok()).toBeTruthy();
  const listItem = await listResponse.json();
  const checked = await page.request.put(`/api/shopping-list/${listItem._id}`, { data: { checked: true } });
  expect(checked.ok()).toBeTruthy();
  const completed = await page.request.post('/api/shopping-list/complete', {
    data: {
      idempotencyKey: `home-deferred-${suffix}`,
      purchases: [{ listItemId: listItem._id, price: null, storeId: store._id }],
      addToPantry: false
    }
  });
  expect(completed.ok()).toBeTruthy();
  return { item, store };
}

test.describe('Home / Today', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
    await page.waitForSelector('#tab-home.active');
  });

  test('opens on Home with the four household questions', async ({ page }) => {
    await expect(page.locator('#tab-home')).toHaveClass(/active/);
    const questions = page.locator('.home-question');
    await expect(questions).toHaveCount(4);
    await expect(questions).toHaveText([
      'What’s for dinner?',
      'What do we need?',
      'Is anything running low?',
      'What should I do next?'
    ]);
  });

  test('uses five parent-centered bottom navigation destinations', async ({ page }) => {
    const nav = page.locator('.bottom-nav .nav-item');
    await expect(nav).toHaveCount(5);
    await expect(nav.locator(':scope > span:nth-child(2)')).toHaveText(['Home', 'Plan', 'List', 'Pantry', 'More']);
  });

  test('moves prices and spend into Insights', async ({ page }) => {
    await page.click('[data-tab="more"]');
    await page.click('.more-item[data-section="insights"]');
    await expect(page.locator('#section-insights')).toBeVisible();
    await expect(page.locator('[data-insight-tab="prices"]')).toBeVisible();
    await expect(page.locator('[data-insight-tab="spend"]')).toBeVisible();
  });

  test('standalone Quick add opens List with rapid capture focused', async ({ page }) => {
    await page.click('#home-quick-add');
    await expect(page.locator('#tab-list')).toHaveClass(/active/);
    await expect(page.locator('#rapid-list-input')).toBeFocused();
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });

  test('empty What do we need Quick add has the same rapid-capture outcome', async ({ page }) => {
    const card = page.locator('.home-card', { hasText: 'What do we need?' });
    await expect(card.getByRole('button', { name: 'Quick add →' })).toBeVisible();
    await card.getByRole('button', { name: 'Quick add →' }).click();
    await expect(page.locator('#tab-list')).toHaveClass(/active/);
    await expect(page.locator('#rapid-list-input')).toBeFocused();
    await expect(page.locator('#modal-overlay')).toBeHidden();
  });

  test('deferred prices become the next action and never look caught up', async ({ page }) => {
    await createDeferredPrice(page);
    await page.evaluate(async () => {
      await loadDeferredPrices();
      homeState.plan = {
        days: [{ date: homeIsoDate(), meals: [{ mealType: 'dinner', name: 'Dinner is planned' }] }]
      };
      homeState.shoppingList = [];
      homeState.lowStock = [];
      homeState.status = { shoppingList: 'fresh', lowStock: 'fresh', plan: 'fresh' };
      renderHome();
    });

    const next = page.locator('.home-card-next');
    await expect(next).toContainText('Finish 1 shopping price');
    await expect(next).toContainText('You chose to review these later.');
    await expect(next).not.toContainText('You’re caught up');
    await next.getByRole('button', { name: 'Review prices →' }).click();
    await expect(page.getByRole('dialog', { name: 'Review prices' })).toBeVisible();
  });

  test('keeps the other Home cards useful when one endpoint fails', async ({ page }) => {
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(key => key.includes('provista_home_') && key.endsWith('_lowStock'))
        .forEach(key => localStorage.removeItem(key));
    });

    let releaseLowStockRequest;
    const lowStockRequestSeen = new Promise(resolve => { releaseLowStockRequest = resolve; });
    await page.route('**/api/inventory/low-stock', async route => {
      releaseLowStockRequest();
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporarily unavailable' })
      });
    });

    await page.reload();
    await lowStockRequestSeen;

    await expect(page.locator('.home-card')).toHaveCount(4);
    await expect(page.locator('.home-card', { hasText: 'Couldn’t load this update' })).toHaveCount(1);
    await expect(page.locator('.home-card', { hasText: 'What’s for dinner?' })).not.toContainText('Couldn’t load');
    await expect(page.locator('.home-card', { hasText: 'What do we need?' })).not.toContainText('Couldn’t load');
  });

  test('Plan dinner opens today, focuses dinner, and accepts tonight’s meal', async ({ page }) => {
    await page.click('#home-plan-dinner');
    await expect(page.locator('#tab-meal-plan')).toHaveClass(/active/);
    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const todayCard = page.locator(`.meal-day[data-date^="${today}"]`);
    await expect(todayCard).toHaveAttribute('data-expanded', 'true');
    const dinner = todayCard.locator('.meal-type-section[data-meal-type="dinner"] .meal-name-input').first();
    await expect(dinner).toBeFocused();
    await dinner.fill('Tonight’s quick dinner');
    await expect(page.locator('#mp-save-status')).toHaveText('Saved ✓', { timeout: 10000 });
  });
});
