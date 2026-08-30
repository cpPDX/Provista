const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createCatalogItem(page, name) {
  const response = await page.request.post('/api/items', {
    data: { name, category: 'Other', unit: 'each' }
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createListItem(page, name) {
  const item = await createCatalogItem(page, name);
  const listResponse = await page.request.post('/api/shopping-list', {
    data: { itemId: item._id, quantity: 1 }
  });
  expect(listResponse.ok()).toBeTruthy();
  return await listResponse.json();
}

test.describe('React Shopping List migration', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    const clear = await page.request.delete('/api/shopping-list');
    expect(clear.ok()).toBeTruthy();
  });

  test('renders the List inside the React application shell', async ({ page }) => {
    const listItem = await createListItem(page, `React List ${Date.now()}`);
    await page.goto('/app/list');

    await expect(page.locator('#react-list-title')).toHaveText('Shopping list');
    await expect(page.locator(`.list-item[data-id="${listItem._id}"]`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('adds one clear catalog match immediately in React', async ({ page }) => {
    const item = await createCatalogItem(page, `React Rapid Single ${Date.now()}`);
    await page.goto('/app/list');

    const input = page.locator('#react-rapid-list-input');
    await input.fill(item.name);
    await page.getByRole('button', { name: 'Add to list', exact: true }).click();

    await expect(page.locator('#react-rapid-status')).toHaveAttribute('data-state', 'success');
    await expect(page.locator('#react-rapid-status')).toContainText('Added 1 item');
    await expect(page.locator('.react-list-item', { hasText: item.name })).toContainText('qty 1');
    await expect(input).toHaveValue('');
  });

  test('reviews several matched groceries before adding and rolls quantity into an existing item', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const [milk, eggs, bananas] = await Promise.all([
      createCatalogItem(page, `React Rapid Milk ${suffix}`),
      createCatalogItem(page, `React Rapid Eggs ${suffix}`),
      createCatalogItem(page, `React Rapid Bananas ${suffix}`)
    ]);
    const existing = await page.request.post('/api/shopping-list', { data: { itemId: milk._id, quantity: 2 } });
    expect(existing.ok()).toBeTruthy();

    await page.goto('/app/list');
    await page.locator('#react-rapid-list-input').fill(`${milk.name} x3, ${eggs.name}, ${bananas.name} x2`);
    await page.getByRole('button', { name: 'Add to list', exact: true }).click();

    await expect(page.locator('.react-rapid-preview')).toBeVisible();
    await expect(page.locator('.react-rapid-preview li')).toHaveCount(3);
    await expect(page.locator('.react-rapid-preview', { hasText: milk.name })).toContainText('× 3');

    let response = await page.request.get('/api/shopping-list');
    expect((await response.json())).toHaveLength(1);

    await page.getByRole('button', { name: 'Add 3 items', exact: true }).click();
    await expect(page.locator('.react-rapid-preview')).toHaveCount(0);
    await expect(page.locator('.react-list-item', { hasText: milk.name })).toContainText('qty 5');
    await expect(page.locator('.react-list-item', { hasText: eggs.name })).toContainText('qty 1');
    await expect(page.locator('.react-list-item', { hasText: bananas.name })).toContainText('qty 2');

    response = await page.request.get('/api/shopping-list');
    const list = await response.json();
    expect(list.filter(entry => [milk._id, eggs._id, bananas._id].includes(entry.itemId?._id))).toHaveLength(3);
  });

  test('resolves ambiguous and unknown groceries through React Add with details', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const [first] = await Promise.all([
      createCatalogItem(page, `React Ambiguous ${suffix} One`),
      createCatalogItem(page, `React Ambiguous ${suffix} Two`)
    ]);
    const ambiguous = `React Ambiguous ${suffix}`;
    const missing = `React Missing ${suffix}`;

    await page.goto('/app/list');
    await page.locator('#react-rapid-list-input').fill(`${ambiguous}, ${missing}`);
    await page.getByRole('button', { name: 'Add to list', exact: true }).click();

    await expect(page.locator('.react-rapid-preview')).toBeVisible();
    await expect(page.locator('.react-rapid-preview')).toContainText('Needs a choice');
    await expect(page.locator('.react-rapid-preview')).toContainText('Needs details');
    await page.getByRole('button', { name: 'Review 2 items', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Add with details' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input').first()).toHaveValue(ambiguous);
    const existingChoice = dialog.getByText(first.name, { exact: false });
    await expect(existingChoice).toBeVisible();
    await existingChoice.click();
    await dialog.getByRole('button', { name: 'Add selected product', exact: true }).click();

    await expect(dialog.locator('input').first()).toHaveValue(missing);
    await dialog.getByRole('button', { name: 'Create & add', exact: true }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#react-rapid-status')).toContainText('All items added');
    await expect(page.locator('.react-list-item', { hasText: first.name })).toBeVisible();
    await expect(page.locator('.react-list-item', { hasText: missing })).toBeVisible();
  });

  test('shows optimistic check-off feedback before a slow write finishes', async ({ page }) => {
    const listItem = await createListItem(page, `React Latency ${Date.now()}`);
    await page.goto('/app/list');
    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await expect(card).toBeVisible();
    await page.route(`**/api/shopping-list/${listItem._id}`, async route => {
      if (route.request().method() === 'PUT') await new Promise(resolve => setTimeout(resolve, 1100));
      await route.continue();
    });

    const feedback = await page.evaluate(id => {
      const button = document.querySelector(`.list-item[data-id="${id}"] .list-item-check-wrap`);
      if (!button) throw new Error(`List item ${id} was not rendered before the latency assertion`);
      const start = performance.now();
      button.click();
      return new Promise(resolve => requestAnimationFrame(() => {
        const renderedCard = document.querySelector(`.list-item[data-id="${id}"]`);
        resolve({ elapsed: performance.now() - start, checked: renderedCard?.classList.contains('checked') === true });
      }));
    }, listItem._id);

    expect(feedback.checked).toBe(true);
    expect(feedback.elapsed).toBeLessThan(150);
    await expect(page.locator('#btn-done-shopping')).toBeVisible();
    await expect.poll(async () => {
      const response = await page.request.get('/api/shopping-list');
      return (await response.json()).find(item => item._id === listItem._id)?.checked;
    }, { timeout: 5000 }).toBe(true);
  });

  test('rolls an optimistic check-off back when persistence fails', async ({ page }) => {
    const listItem = await createListItem(page, `React Rollback ${Date.now()}`);
    await page.goto('/app/list');
    await page.route(`**/api/shopping-list/${listItem._id}`, async route => {
      if (route.request().method() === 'PUT') {
        await new Promise(resolve => setTimeout(resolve, 350));
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Store unavailable' }) });
      } else {
        await route.continue();
      }
    });

    const card = page.locator(`.list-item[data-id="${listItem._id}"]`);
    await card.locator('.list-item-check-wrap').click();
    await expect(card).toHaveClass(/checked/);
    await expect(card).not.toHaveClass(/checked/, { timeout: 3000 });
    await expect(page.locator('.shell-toast-region')).toContainText('rolled back');
  });
});
