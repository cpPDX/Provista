const { test, expect } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

async function createItem(page, name, category = 'Other', unit = 'each') {
  const response = await page.request.post('/api/items', {
    data: { name, category, unit }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe('Post-release recovery states', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsNewUser(page, baseURL);
  });

  test('Manage Products turns an unfiltered no-match search into a prefilled Add Product action', async ({ page }) => {
    const name = `Oat Creamer ${Date.now()}`;

    await page.click('[data-tab="more"]');
    await page.locator('.more-item[data-section="items"]').click();
    await page.fill('#catalog-search', name);

    await expect(page.getByText(`No products match “${name}”.`)).toBeVisible();
    const addProduct = page.getByRole('button', { name: `Add Product “${name}”` });
    await expect(addProduct).toBeVisible();
    await addProduct.click();

    await expect(page.locator('#modal-title')).toHaveText('New Item');
    await expect(page.locator('#new-item-form [name="name"]')).toHaveValue(name);
    await page.fill('#new-item-form [name="category"]', 'Beverages');
    await page.fill('#new-item-form [name="unit"]', 'each');
    await page.getByRole('button', { name: 'Create Item' }).click();

    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('#catalog-search')).toHaveValue('');
    await expect(page.locator('#catalog-list .card', { hasText: name })).toBeVisible();
  });

  test('Manage Products clears filters instead of suggesting creation when an existing product is hidden', async ({ page }) => {
    const suffix = Date.now();
    const visibleUnderFilter = await createItem(page, `Filtered Dairy ${suffix}`, 'Dairy');
    const hiddenByFilter = await createItem(page, `Hidden Beverage ${suffix}`, 'Beverages');
    expect(visibleUnderFilter._id).toBeTruthy();

    await page.click('[data-tab="more"]');
    await page.locator('.more-item[data-section="items"]').click();
    await expect(page.getByText(hiddenByFilter.name, { exact: true })).toBeVisible();

    await page.locator('#btn-catalog-filter').click();
    await page.locator('#catalog-category-chips [data-category="Dairy"]').click();
    await page.locator('#filter-sheet-done').click();
    await page.fill('#catalog-search', hiddenByFilter.name);

    await expect(page.getByText(`No products match “${hiddenByFilter.name}” with the current filters.`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    await expect(page.getByRole('button', { name: `Add Product “${hiddenByFilter.name}”` })).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByText(hiddenByFilter.name, { exact: true })).toBeVisible();
  });
});