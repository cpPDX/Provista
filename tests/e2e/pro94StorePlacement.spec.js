const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createListItem(page, { name, category, unit = 'each', storeId = null }) {
  const productResponse = await page.request.post('/api/items', {
    data: { name, category, unit }
  });
  expect(productResponse.ok()).toBeTruthy();
  const product = await productResponse.json();

  const listResponse = await page.request.post('/api/shopping-list', {
    data: { itemId: product._id, quantity: 1, ...(storeId ? { storeId } : {}) }
  });
  expect(listResponse.ok()).toBeTruthy();
  return { product, listItem: await listResponse.json() };
}

async function createStore(page, name) {
  const response = await page.request.post('/api/stores', { data: { name } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe('PRO-94 store departments and optional sub-sections', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    expect((await page.request.delete('/api/shopping-list')).ok()).toBeTruthy();
  });

  test('shows sub-section headings only when at least two useful groups reduce scanning and keeps the layout stable while shopping', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const firstSnack = await createListItem(page, { name: `PRO94 Chips A ${suffix}`, category: 'Snacks', unit: 'oz' });
    await createListItem(page, { name: `PRO94 Chips B ${suffix}`, category: 'Snacks', unit: 'oz' });
    await createListItem(page, { name: `PRO94 Ketchup A ${suffix}`, category: 'Condiments & Sauces', unit: 'bottle' });
    await createListItem(page, { name: `PRO94 Ketchup B ${suffix}`, category: 'Condiments & Sauces', unit: 'bottle' });
    await createListItem(page, { name: `PRO94 Rice ${suffix}`, category: 'Pantry', unit: 'bag' });

    await page.goto('/app/list');
    const pantry = page.locator('.react-list-section-group[data-section="Pantry / Dry Grocery"]');
    await expect(pantry).toBeVisible();
    await expect(pantry.locator('.react-list-section-heading h3')).toHaveText('Pantry / Dry Grocery');
    await expect(pantry.locator('.react-list-subsection-heading h4')).toHaveText(['Sauces & Condiments', 'Snacks']);
    await expect(pantry.getByText(`PRO94 Rice ${suffix}`, { exact: true })).toBeVisible();
    await expect(pantry.locator('.react-list-subsection-heading h4', { hasText: 'Pasta, Rice & Grains' })).toHaveCount(0);

    const firstCard = page.locator(`.react-list-item[data-id="${firstSnack.listItem._id}"]`);
    await firstCard.getByRole('button', { name: `Mark as purchased ${firstSnack.product.name}` }).click();
    await expect(firstCard).toHaveClass(/checked/);
    await expect(pantry.locator('.react-list-subsection-heading h4')).toHaveText(['Sauces & Condiments', 'Snacks']);

    await page.goto('/app/pantry');
    await page.goto('/app/list');
    const restoredPantry = page.locator('.react-list-section-group[data-section="Pantry / Dry Grocery"]');
    await expect(restoredPantry.locator('.react-list-subsection-heading h4')).toHaveText(['Sauces & Condiments', 'Snacks']);
  });

  test('does not recompute a store department layout when buy-here check-off moves an item to the active store', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const plannedStore = await createStore(page, `PRO94 Planned ${suffix}`);
    const activeStore = await createStore(page, `PRO94 Active ${suffix}`);

    const activeItem = await createListItem(page, {
      name: `PRO94 Active Bananas ${suffix}`,
      category: 'Produce',
      storeId: activeStore._id
    });
    const movingSnack = await createListItem(page, {
      name: `PRO94 Moving Chips ${suffix}`,
      category: 'Snacks',
      unit: 'oz',
      storeId: plannedStore._id
    });
    await createListItem(page, {
      name: `PRO94 Staying Chips ${suffix}`,
      category: 'Snacks',
      unit: 'oz',
      storeId: plannedStore._id
    });
    await createListItem(page, {
      name: `PRO94 Ketchup A ${suffix}`,
      category: 'Condiments & Sauces',
      unit: 'bottle',
      storeId: plannedStore._id
    });
    await createListItem(page, {
      name: `PRO94 Ketchup B ${suffix}`,
      category: 'Condiments & Sauces',
      unit: 'bottle',
      storeId: plannedStore._id
    });

    await page.goto('/app/list');
    const plannedGroup = page.getByRole('region', { name: `Suggested stop ${plannedStore.name}` });
    const plannedPantry = plannedGroup.locator('.react-list-section-group[data-section="Pantry / Dry Grocery"]');
    await expect(plannedPantry.locator('.react-list-subsection-heading h4')).toHaveText(['Sauces & Condiments', 'Snacks']);

    const activeCard = page.locator(`.react-list-item[data-id="${activeItem.listItem._id}"]`);
    await activeCard.getByRole('button', { name: `Mark as purchased ${activeItem.product.name}` }).click();
    await expect(activeCard).toHaveClass(/checked/);

    const movingCard = page.locator(`.react-list-item[data-id="${movingSnack.listItem._id}"]`);
    await movingCard.getByRole('button', { name: `Mark as purchased ${movingSnack.product.name}` }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText(`This item is planned for ${plannedStore.name}.`);
    await confirmation.getByRole('button', { name: 'Buy here instead' }).click();

    await expect(page.getByRole('region', { name: `Suggested stop ${activeStore.name}` })
      .locator(`.react-list-item[data-id="${movingSnack.listItem._id}"]`)).toHaveClass(/checked/);
    await expect(plannedPantry.locator('.react-list-subsection-heading h4')).toHaveText(['Sauces & Condiments', 'Snacks']);
  });

  test('keeps sparse departments flat instead of adding singleton heading noise', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    await createListItem(page, { name: `PRO94 Frozen Pizza ${suffix}`, category: 'Frozen' });
    await createListItem(page, { name: `PRO94 Frozen Peas ${suffix}`, category: 'Frozen' });
    await createListItem(page, { name: `PRO94 Frozen Waffles ${suffix}`, category: 'Frozen' });

    await page.goto('/app/list');
    const frozen = page.locator('.react-list-section-group[data-section="Frozen"]');
    await expect(frozen).toBeVisible();
    await expect(frozen.locator('.react-list-subsection-heading')).toHaveCount(0);
    await expect(frozen.locator('.react-list-item')).toHaveCount(3);
  });

  test('corrects placement from item details, defaults to concrete-store scope, preserves custom values, and offers undo for known incompatibility', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const store = await createStore(page, `PRO94 Market ${suffix}`);
    const { product, listItem } = await createListItem(page, {
      name: `PRO94 Frozen Pizza ${suffix}`,
      category: 'Frozen',
      storeId: store._id
    });

    const explicitSubSection = await page.request.put(`/api/item-sections/${product._id}`, {
      data: { subSection: 'Pizza' }
    });
    expect(explicitSubSection.ok()).toBeTruthy();

    await page.goto('/app/list');
    const card = page.locator(`.react-list-item[data-id="${listItem._id}"]`);
    await card.getByRole('button', { name: `Open item details for ${product.name}` }).click();
    const details = page.getByRole('dialog', { name: product.name });
    await expect(details).toContainText('Department: Frozen');
    await expect(details).toContainText('Sub-section: Pizza');

    await details.getByRole('button', { name: /Edit shopping placement/ }).click();
    const editor = page.getByRole('dialog', { name: 'Department and sub-section' });
    await expect(editor.getByRole('radio', { name: `This store - ${store.name}` })).toBeChecked();
    await editor.getByRole('radio', { name: 'All stores' }).check();

    await editor.getByLabel('Department').fill('Dairy & Eggs');
    await expect(editor.getByText(/Pizza is a known sub-section of a different department/)).toBeVisible();
    await editor.getByRole('button', { name: 'Undo' }).click();
    await expect(editor.getByLabel('Sub-section optional')).toHaveValue('Pizza');

    await editor.getByLabel('Sub-section optional').fill('Vendor Picks');
    await editor.getByLabel('Department').fill('Specialty');
    await expect(editor.getByLabel('Sub-section optional')).toHaveValue('Vendor Picks');
    await editor.getByRole('button', { name: 'Save placement' }).click();

    await expect(details).toContainText('Department: Specialty');
    await expect(details).toContainText('Sub-section: Vendor Picks');

    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await details.getByRole('button', { name: /Edit shopping placement/ }).click();
    const zoomedEditor = page.getByRole('dialog', { name: 'Department and sub-section' });
    const metrics = await zoomedEditor.evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      actionHeights: [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect().height)
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(Math.min(...metrics.actionHeights)).toBeGreaterThanOrEqual(44);
  });
});
