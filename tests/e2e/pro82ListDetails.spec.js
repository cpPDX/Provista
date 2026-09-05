const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

async function createListItem(page, suffix) {
  const productResponse = await page.request.post('/api/items', {
    data: { name: `PRO82 Beans ${suffix}`, category: 'Pantry', unit: 'can' }
  });
  expect(productResponse.ok()).toBeTruthy();
  const product = await productResponse.json();
  const listResponse = await page.request.post('/api/shopping-list', {
    data: { itemId: product._id, quantity: 5 }
  });
  expect(listResponse.ok()).toBeTruthy();
  return { product, listItem: await listResponse.json() };
}

test.describe('PRO-82 compact List item details', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page, baseURL }) => {
    await loginAsReactHomeUser(page, baseURL);
    expect((await page.request.delete('/api/shopping-list')).ok()).toBeTruthy();
  });

  test('keeps the card scan-first while preserving separate check-off, quantity, and details actions', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const { product, listItem } = await createListItem(page, suffix);
    await page.goto('/app/list');

    const card = page.locator(`.react-list-item[data-id="${listItem._id}"]`);
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: `Open item details for ${product.name}` })).toBeVisible();
    await expect(card.getByRole('button', { name: `Edit quantity for ${product.name}, currently 5` })).toBeVisible();
    await expect(card.getByRole('button', { name: `Mark as purchased ${product.name}` })).toBeVisible();
    await expect(card).not.toContainText('Store:');
    await expect(card).not.toContainText('Section:');
    await expect(card).not.toContainText('Pantry:');

    await card.getByRole('button', { name: `Open item details for ${product.name}` }).click();
    const details = page.getByRole('dialog', { name: product.name });
    await expect(details).toBeVisible();
    await expect(details).toContainText('Buy 5');
    await expect(details).toContainText('Store preference: Any store');
    await expect(details).toContainText('Section: Pantry');
    await expect(details).toContainText('Not in Pantry');

    const rhythm = await details.evaluate(element => {
      const content = element.querySelector('.react-list-item-detail-content');
      const section = element.querySelector('.react-list-detail-section');
      const contentStyle = content ? getComputedStyle(content) : null;
      const sectionStyle = section ? getComputedStyle(section) : null;
      return {
        contentGap: contentStyle ? Number.parseFloat(contentStyle.rowGap) : Infinity,
        sectionPaddingTop: sectionStyle ? Number.parseFloat(sectionStyle.paddingTop) : Infinity,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      };
    });
    expect(rhythm.contentGap).toBeLessThanOrEqual(9);
    expect(rhythm.sectionPaddingTop).toBeLessThanOrEqual(10);
    expect(rhythm.scrollHeight).toBeLessThanOrEqual(rhythm.clientHeight + 1);

    await details.getByRole('button', { name: 'Close item details' }).click();
    await card.getByRole('button', { name: `Mark as purchased ${product.name}` }).click();
    await expect(card).toHaveClass(/checked/);
    await expect(page.getByRole('dialog', { name: product.name })).toHaveCount(0);
  });

  test('remains usable at 200% text without horizontal clipping', async ({ page }) => {
    const suffix = `${Date.now()}-${test.info().workerIndex}`;
    const { product, listItem } = await createListItem(page, suffix);
    await page.goto('/app/list');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });

    const card = page.locator(`.react-list-item[data-id="${listItem._id}"]`);
    await expect(card.getByRole('button', { name: `Open item details for ${product.name}` })).toBeVisible();
    const metrics = await card.evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  });
});
