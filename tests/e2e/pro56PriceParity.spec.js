const { test, expect } = require('@playwright/test');

async function createHouseholdSession(page, suffix) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      name: `PRO-56 Price ${suffix}`,
      email: `pro56-price-${suffix}-${Date.now()}@test.com`,
      password: 'password123',
      action: 'create',
      householdName: `PRO-56 Price Household ${suffix}`
    }
  });
  expect(response.ok()).toBeTruthy();
}

async function createItem(page, data) {
  const response = await page.request.post('/api/items', { data });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createStore(page, data) {
  const response = await page.request.post('/api/stores', { data });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createPrice(page, data) {
  const response = await page.request.post('/api/prices', { data });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.describe('PRO-56 React Prices parity', () => {
  test('persists complete inline product metadata and price notes without legacy UI', async ({ page }) => {
    await createHouseholdSession(page, 'Metadata');

    await page.goto('/app/more/insights/prices');
    await page.getByRole('button', { name: 'Record price', exact: true }).first().click();
    const form = page.locator('form[aria-labelledby="record-price-title"]');

    await form.getByLabel('Product').selectOption({ label: 'Add a new product…' });
    await form.getByLabel('Product name').fill('PRO-56 Complete Product');
    await form.getByLabel('Brand').fill('Parity Brand');
    await form.getByLabel('Category').fill('Pantry');
    await form.getByLabel('Unit').fill('oz');
    await form.getByLabel('Package size').fill('12');
    await form.getByLabel('Organic').check();

    await form.getByLabel('Store').selectOption({ label: 'Add a new store…' });
    await form.getByLabel('Store name').fill('PRO-56 Complete Store');
    await form.getByLabel('Regular price').fill('5.49');
    await form.getByText('Sale or coupon details', { exact: true }).click();
    await form.getByLabel('Notes').fill('member-facing price note');
    await form.getByRole('button', { name: 'Record price', exact: true }).click();

    await expect(page.getByText('Price recorded')).toBeVisible();
    await expect(page.locator('#tab-prices')).toHaveCount(0);

    const itemsResponse = await page.request.get('/api/items');
    expect(itemsResponse.ok()).toBeTruthy();
    const items = await itemsResponse.json();
    const item = items.find(entry => entry.name === 'PRO-56 Complete Product');
    expect(item).toBeTruthy();
    expect(Number(item.size)).toBe(12);
    expect(item.isOrganic).toBe(true);

    const pricesResponse = await page.request.get(`/api/prices?itemId=${item._id}`);
    expect(pricesResponse.ok()).toBeTruthy();
    const prices = await pricesResponse.json();
    expect(prices[0].notes).toBe('member-facing price note');
  });

  test('shows best unit value, deletes approved history, and reuses the React barcode resolver', async ({ page }) => {
    await createHouseholdSession(page, 'ValueBarcode');
    const item = await createItem(page, {
      name: 'PRO-56 Value Item',
      category: 'Pantry',
      unit: 'each',
      upc: '012345678905',
      upcSource: 'manual'
    });
    const valueStore = await createStore(page, { name: 'PRO-56 Value Store' });
    const otherStore = await createStore(page, { name: 'PRO-56 Other Store' });
    await createPrice(page, { itemId: item._id, storeId: valueStore._id, regularPrice: 4, quantity: 2, source: 'manual' });
    await createPrice(page, { itemId: item._id, storeId: otherStore._id, regularPrice: 3, quantity: 1, source: 'manual' });

    await page.goto('/app/more/insights/prices');
    const historyCard = page.locator('.more-price-card').filter({ hasText: item.name });
    await historyCard.locator('summary').click();
    await expect(historyCard.getByText(/Best recent value:/)).toContainText('$2.00 / each at PRO-56 Value Store');
    await expect(historyCard.getByText(/Saves/)).toContainText('$1.00 per each');

    await historyCard.getByRole('button', {
      name: `Delete price entry for ${item.name} from ${otherStore.name}`
    }).click();
    const deleteDialog = page.getByRole('alertdialog', { name: 'Delete this price entry?' });
    await expect(deleteDialog).toContainText('Standalone logged purchases can also change Spending');
    await deleteDialog.getByRole('button', { name: 'Delete price' }).click();
    await expect(page.getByText('Price entry deleted')).toBeVisible();
    await expect(historyCard).not.toContainText(otherStore.name);
    await expect(page.locator('#tab-prices')).toHaveCount(0);

    await page.getByRole('button', { name: 'Record price', exact: true }).first().click();
    const form = page.locator('form[aria-labelledby="record-price-title"]');
    await form.getByRole('button', { name: 'Scan product barcode' }).click();

    const scanner = page.getByRole('dialog', { name: 'Scan a product' });
    await expect(scanner).toBeVisible();
    await scanner.getByRole('button', { name: 'Enter UPC instead' }).click();
    await scanner.getByLabel('UPC / EAN').fill('012345678905');
    await scanner.getByRole('button', { name: 'Look up product' }).click();

    await expect(scanner).toHaveCount(0);
    await expect(form.getByLabel('Product')).toHaveValue(item._id);
    await expect(page.getByText(`${item.name} selected from barcode`)).toBeVisible();
    await expect(page.locator('#scanner-overlay')).toHaveCount(0);
  });

  test('lets an admin correct a pending household price while approving it', async ({ page }) => {
    await createHouseholdSession(page, 'PendingEdit');
    const item = await createItem(page, { name: 'PRO-56 Pending Item', category: 'Pantry', unit: 'each' });
    const store = await createStore(page, { name: 'PRO-56 Pending Store' });
    const pendingEntry = {
      _id: '507f1f77bcf86cd799439011',
      itemId: item,
      storeId: store,
      regularPrice: 4.29,
      salePrice: null,
      couponAmount: null,
      couponCode: null,
      quantity: 1,
      finalPrice: 4.29,
      pricePerUnit: 4.29,
      date: new Date().toISOString(),
      notes: 'submitted note',
      status: 'pending'
    };
    let approvedBody = null;

    await page.route('**/api/prices/pending', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([pendingEntry]) });
    });
    await page.route('**/api/prices/*/approve', async route => {
      approvedBody = route.request().postDataJSON();
      const finalPrice = approvedBody.salePrice != null && approvedBody.salePrice < approvedBody.regularPrice
        ? approvedBody.salePrice - (approvedBody.couponAmount || 0)
        : approvedBody.regularPrice - (approvedBody.couponAmount || 0);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...pendingEntry,
          ...approvedBody,
          storeId: store,
          finalPrice,
          pricePerUnit: finalPrice / approvedBody.quantity,
          status: 'approved'
        })
      });
    });

    await page.goto('/app/more/insights/prices');
    const pendingCard = page.locator('.more-record-card').filter({ hasText: item.name });
    await expect(pendingCard).toContainText('submitted note');
    await pendingCard.getByRole('button', { name: 'Edit & Approve' }).click();

    const editForm = page.locator('form[aria-labelledby^="pending-price-edit-"]');
    await editForm.getByLabel('Regular price').fill('5.00');
    await editForm.getByLabel('Quantity').fill('2');
    await editForm.getByLabel('Notes').fill('corrected before approval');
    await editForm.getByRole('button', { name: 'Save and approve' }).click();

    await expect(page.getByText('Price corrected and approved')).toBeVisible();
    expect(approvedBody.regularPrice).toBe(5);
    expect(approvedBody.quantity).toBe(2);
    expect(approvedBody.notes).toBe('corrected before approval');
    expect(approvedBody.storeId).toBe(store._id);
    await expect(page.getByRole('heading', { name: 'Prices awaiting review' })).toHaveCount(0);
  });
});
