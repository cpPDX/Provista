const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

async function createCatalogItem(page, name) {
  const response = await page.request.post('/api/items', {
    data: { name, category: 'Other', unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe('Outcome-focused confirmations', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
  });

  test('List removal explains the outcome and uses an explicit verb', async ({ page }) => {
    const item = await createCatalogItem(page, `Remove List ${Date.now()}`);
    await page.request.post('/api/shopping-list', { data: { itemId: item._id, quantity: 1 } });
    await page.click('[data-tab="list"]');

    const card = page.locator('.list-item', { hasText: item.name });
    await card.locator('.list-item-remove').click();
    await expect(page.locator('#modal-title')).toHaveText('Remove from list?');
    await expect(page.getByRole('button', { name: 'Remove from list', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(card).toBeVisible();
  });

  test('Empty list is secondary and confirms what will not change', async ({ page }) => {
    const item = await createCatalogItem(page, `Empty List ${Date.now()}`);
    await page.request.post('/api/shopping-list', { data: { itemId: item._id, quantity: 1 } });
    await page.click('[data-tab="list"]');

    await page.locator('#list-page-more-menu > summary').click();
    await page.locator('#btn-clear-all').click();
    await expect(page.locator('#modal-title')).toHaveText('Empty the shopping list?');
    await expect(page.locator('#modal-body')).toContainText('Pantry, Spending, and price history will not change');
    await expect(page.getByRole('button', { name: 'Empty list', exact: true })).toBeVisible();
  });

  test('Pantry removal uses the same confirmation contract', async ({ page }) => {
    const item = await createCatalogItem(page, `Remove Pantry ${Date.now()}`);
    const inventoryResponse = await page.request.post('/api/inventory', {
      data: { itemId: item._id, trackingMode: 'simple', stockStatus: 'have' }
    });
    expect(inventoryResponse.ok()).toBeTruthy();
    await page.click('[data-tab="inventory"]');

    const card = page.locator('.pantry-card', { hasText: item.name });
    await card.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('#modal-title')).toHaveText('Remove from Pantry?');
    await expect(page.getByRole('button', { name: 'Remove from Pantry', exact: true })).toBeVisible();
  });

  test('Sign Out uses the same modal pattern instead of browser confirm', async ({ page }) => {
    await page.click('[data-tab="more"]');
    await page.locator('#btn-logout').click();
    await expect(page.locator('#modal-title')).toHaveText('Sign out?');
    await expect(page.locator('#modal-body')).toContainText('household data stays saved');
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  });

  test('separate meal removal uses the shared confirmation modal', async ({ page }) => {
    await page.click('[data-tab="meal-plan"]');
    const dinnerSection = page.locator('.meal-type-section[data-meal-type="dinner"]').first();
    await dinnerSection.locator('.meal-add-row').click();
    const removableRow = dinnerSection.locator('.meal-row').last();
    await removableRow.locator('.meal-row-remove').click();

    await expect(page.locator('#modal-title')).toHaveText('Remove separate meal?');
    await expect(page.getByRole('button', { name: 'Remove meal', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(removableRow).toBeVisible();
  });
});
