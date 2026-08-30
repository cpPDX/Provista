const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createListItem(page, name) {
  const itemResponse = await page.request.post('/api/items', {
    data: { name, category: 'Other', unit: 'each' }
  });
  expect(itemResponse.ok()).toBeTruthy();
  const item = await itemResponse.json();
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
