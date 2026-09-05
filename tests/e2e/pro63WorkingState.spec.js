const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createCatalogItem(page, name, category = 'Other') {
  const response = await page.request.post('/api/items', {
    data: { name, category, unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createListItem(page, item, quantity = 1) {
  const response = await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createPantryItem(page, item) {
  const response = await page.request.post('/api/inventory', {
    data: { itemId: item._id, trackingMode: 'simple', stockStatus: 'have', unit: item.unit || 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe('PRO-63 working state persistence', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
  });

  test('restores focused Plan day after primary navigation and reload', async ({ page }) => {
    await page.goto('/app/plan');
    const days = page.getByRole('navigation', { name: 'Days in this plan' }).getByRole('button');
    await expect(days).toHaveCount(7);
    await days.nth(3).click();
    const selectedLabel = await days.nth(3).getAttribute('aria-label');
    await expect(days.nth(3)).toHaveAttribute('aria-current', 'date');

    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Days in this plan' }).getByRole('button').nth(3)).toHaveAttribute('aria-current', 'date');

    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Days in this plan' }).getByRole('button').nth(3)).toHaveAttribute('aria-current', 'date');
    await expect(page.locator('.plan-focused-day h2')).toContainText((selectedLabel || '').split(',')[0]);
  });

  test('restores useful List filters and expanded tools but not item dialogs', async ({ page }) => {
    expect((await page.request.delete('/api/shopping-list')).ok()).toBeTruthy();
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const produce = await createCatalogItem(page, `PRO63 Apples ${suffix}`, 'Produce');
    const pantry = await createCatalogItem(page, `PRO63 Rice ${suffix}`, 'Pantry');
    const produceList = await createListItem(page, produce);
    await createListItem(page, pantry);

    await page.goto('/app/list');
    const category = page.getByLabel('Category');
    await category.selectOption('Produce');
    await expect(page.locator('.react-list-item', { hasText: produce.name })).toBeVisible();
    await expect(page.locator('.react-list-item', { hasText: pantry.name })).toHaveCount(0);

    // Verify modal/edit state is ephemeral before expanding the mobile tools
    // panel, which intentionally sits above the list while open.
    const produceCard = page.locator(`.react-list-item[data-id="${produceList._id}"]`);
    await produceCard.getByRole('button', { name: `Open item details for ${produce.name}` }).click();
    await expect(page.getByRole('dialog', { name: produce.name, exact: true })).toBeVisible();

    await page.goto('/app/pantry');
    await page.goto('/app/list');
    await expect(page.getByLabel('Category')).toHaveValue('Produce');
    await expect(page.getByRole('dialog', { name: produce.name, exact: true })).toHaveCount(0);

    // Expanded tools are intentional workspace state and should survive a
    // separate navigation round trip without requiring clicks through the panel.
    const moreTools = page.locator('details.react-list-more-tools');
    await moreTools.locator('summary').click();
    await expect(moreTools).toHaveAttribute('open', '');

    await page.goto('/app/pantry');
    await page.goto('/app/list');
    await expect(page.getByLabel('Category')).toHaveValue('Produce');
    await expect(page.locator('details.react-list-more-tools')).toHaveAttribute('open', '');

    await page.reload();
    await expect(page.getByLabel('Category')).toHaveValue('Produce');
    await expect(page.locator('details.react-list-more-tools')).toHaveAttribute('open', '');
  });

  test('restores Pantry search across navigation and reload', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const apples = await createCatalogItem(page, `PRO63 Pantry Apples ${suffix}`, 'Produce');
    const rice = await createCatalogItem(page, `PRO63 Pantry Rice ${suffix}`, 'Pantry');
    await createPantryItem(page, apples);
    await createPantryItem(page, rice);

    await page.goto('/app/pantry');
    const search = page.getByLabel('Search Pantry');
    await search.fill(apples.name);
    await expect(page.locator('.pantry-card', { hasText: apples.name })).toBeVisible();
    await expect(page.locator('.pantry-card', { hasText: rice.name })).toHaveCount(0);

    await page.getByRole('button', { name: 'Plan', exact: true }).click();
    await page.getByRole('button', { name: 'Pantry', exact: true }).click();
    await expect(page.getByLabel('Search Pantry')).toHaveValue(apples.name);
    await expect(page.locator('.pantry-card', { hasText: rice.name })).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel('Search Pantry')).toHaveValue(apples.name);
    await expect(page.locator('.pantry-card', { hasText: apples.name })).toBeVisible();
  });
});
