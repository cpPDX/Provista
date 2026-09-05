const { test, expect } = require('@playwright/test');

async function createHouseholdSession(page, suffix) {
  const response = await page.request.post('/api/auth/register', {
    data: {
      name: `PRO-56 ${suffix}`,
      email: `pro56-${suffix}-${Date.now()}@test.com`,
      password: 'password123',
      action: 'create',
      householdName: `PRO-56 Household ${suffix}`
    }
  });
  expect(response.ok()).toBeTruthy();
}

async function createInsightFixture(page, suffix, price = 3.25) {
  const itemResponse = await page.request.post('/api/items', {
    data: { name: `PRO-56 Insight Item ${suffix}`, category: 'Pantry', unit: 'each' }
  });
  const storeResponse = await page.request.post('/api/stores', {
    data: { name: `PRO-56 Insight Store ${suffix}`, location: 'North' }
  });
  expect(itemResponse.ok()).toBeTruthy();
  expect(storeResponse.ok()).toBeTruthy();
  const item = await itemResponse.json();
  const store = await storeResponse.json();
  const priceResponse = await page.request.post('/api/prices', {
    data: { itemId: item._id, storeId: store._id, regularPrice: price, quantity: 1, source: 'manual' }
  });
  expect(priceResponse.ok()).toBeTruthy();
  return { item, store };
}

test.describe('PRO-56 legacy authenticated UI retirement', () => {
  test('keeps Help & About and the App Tour inside the React shell', async ({ page }) => {
    await createHouseholdSession(page, 'HelpTour');

    await page.goto('/app/more');
    await expect(page.locator('#more-title')).toHaveText('More');
    await page.getByRole('link', { name: /Help & About/ }).click();

    await expect(page).toHaveURL(/\/app\/more\/help$/);
    await expect(page.locator('.shell-brand')).toBeVisible();
    await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#help-about-title')).toHaveText('Plan together. Shop with clarity.');
    await expect(page.getByText('Home → Plan → List → Shop → Pantry')).toBeVisible();
    await expect(page.getByText(/Add with details/)).toBeVisible();
    await expect(page.getByText(/Finish shopping/)).toBeVisible();
    await expect(page.getByText(/Simple tracking/)).toBeVisible();
    await expect(page.getByText(/Exact tracking/)).toBeVisible();
    await expect(page.getByText(/Open Prices observations are community-reported shopping context only/)).toBeVisible();
    await expect(page.locator('#section-about')).toHaveCount(0);

    await page.reload();
    await expect(page).toHaveURL(/\/app\/more\/help$/);
    await expect(page.locator('#help-about-title')).toBeVisible();
    await expect(page.locator('.shell-brand')).toBeVisible();

    await page.getByRole('button', { name: 'Restart App Tour' }).click();
    const tour = page.getByRole('dialog', { name: 'Home / Today' });
    await expect(tour).toBeVisible();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('#tour-title')).toHaveText('Home / Today');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/plan$/);
    await expect(page.locator('#tour-title')).toHaveText('Plan');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/list$/);
    await expect(page.locator('#tour-title')).toHaveText('Shopping List');
    await expect(page.locator('#tour-text')).toContainText('Finish shopping completes one store stop at a time');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/pantry$/);
    await expect(page.locator('#tour-title')).toHaveText('Pantry');
    await expect(page.locator('#tour-text')).toContainText('simple Have, Running low, and Out tracking');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/more$/);
    await expect(page.locator('#tour-title')).toHaveText('More');
    await expect(page.locator('#tab-more')).toHaveCount(0);

    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('starts the App Tour from More without a legacy navigation', async ({ page }) => {
    await createHouseholdSession(page, 'TourEntry');

    await page.goto('/app/more');
    await page.getByRole('button', { name: /App Tour/ }).click();

    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator('#tour-title')).toHaveText('Home / Today');
    await expect(page.locator('.shell-brand')).toBeVisible();
    await expect(page.locator('#tab-home')).toHaveCount(0);
  });

  test('keeps My Account React-owned and preserves profile updates across reload', async ({ page }) => {
    await createHouseholdSession(page, 'Account');

    await page.goto('/app/more');
    await page.getByRole('link', { name: /My Account/ }).click();

    await expect(page).toHaveURL(/\/app\/more\/account$/);
    await expect(page.locator('#account-title')).toHaveText('My Account');
    await expect(page.locator('.shell-brand')).toBeVisible();
    await expect(page.locator('#section-account')).toHaveCount(0);

    await page.getByLabel('Preferred name').fill('Account Owner');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile updated')).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/app\/more\/account$/);
    await expect(page.locator('#account-title')).toBeVisible();
    await expect(page.getByLabel('Preferred name')).toHaveValue('Account Owner');
    await expect(page.locator('#section-account')).toHaveCount(0);
  });

  test('keeps Household React-owned with planning people and invites', async ({ page }) => {
    await createHouseholdSession(page, 'Household');

    await page.goto('/app/more');
    await page.getByRole('link', { name: /^Household\b/ }).click();

    await expect(page).toHaveURL(/\/app\/more\/household$/);
    await expect(page.locator('#household-title')).toHaveText('Household');
    await expect(page.getByRole('heading', { name: 'Our household' })).toBeVisible();
    await expect(page.locator('#section-household')).toHaveCount(0);

    await page.getByLabel('Add a planning-only person').fill('Wiz');
    await page.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText('Wiz', { exact: true })).toBeVisible();
    await expect(page.getByText('Planning only', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Show invite' }).click();
    await expect(page.getByText('Invite code', { exact: true })).toBeVisible();
    await expect(page.locator('img[alt^="QR code for household invite"]')).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/app\/more\/household$/);
    await expect(page.getByText('Wiz', { exact: true })).toBeVisible();
    await expect(page.locator('#section-household')).toHaveCount(0);
  });

  test('keeps Stores React-owned and supports add/edit without legacy navigation', async ({ page }) => {
    await createHouseholdSession(page, 'Stores');

    await page.goto('/app/more');
    await page.getByRole('link', { name: /^Stores\b/ }).click();

    await expect(page).toHaveURL(/\/app\/more\/stores$/);
    await expect(page.locator('#stores-title')).toHaveText('Stores');
    await expect(page.locator('#section-stores')).toHaveCount(0);

    await page.getByLabel('Store name').first().fill('PRO-56 Market');
    await page.getByLabel(/Location/).first().fill('North');
    await page.getByRole('button', { name: 'Add store' }).click();
    const storeCard = page.locator('.more-record-card').filter({ hasText: 'PRO-56 Market' });
    await expect(storeCard).toContainText('North');

    await storeCard.getByRole('button', { name: 'Edit' }).click();
    const editForm = page.locator('form.more-record-card');
    await expect(editForm.getByLabel('Store name')).toHaveValue('PRO-56 Market');
    await editForm.getByLabel('Store name').fill('PRO-56 Market Updated');
    await editForm.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('PRO-56 Market Updated', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/app\/more\/stores$/);
    await expect(page.getByText('PRO-56 Market Updated', { exact: true })).toBeVisible();
    await expect(page.locator('#section-stores')).toHaveCount(0);
  });

  test('keeps Insights, Price History, Spending, and drill-down inside React', async ({ page }) => {
    await createHouseholdSession(page, 'Insights');
    const { item } = await createInsightFixture(page, 'Flow', 3.25);

    await page.goto('/app/more');
    await page.getByRole('link', { name: /^Insights\b/ }).click();
    await expect(page).toHaveURL(/\/app\/more\/insights$/);
    await expect(page.locator('#insights-title')).toHaveText('Insights');
    await expect(page.locator('#section-insights')).toHaveCount(0);

    await page.getByRole('link', { name: /^Price history\b/ }).click();
    await expect(page).toHaveURL(/\/app\/more\/insights\/prices$/);
    await expect(page.locator('#price-history-title')).toHaveText('Price history');
    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
    await expect(page.locator('#tab-prices')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('#price-history-title')).toBeVisible();
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await page.getByRole('link', { name: /^Spending\b/ }).click();
    await expect(page).toHaveURL(/\/app\/more\/insights\/spending$/);
    await expect(page.locator('#spending-title')).toHaveText('Spending');
    await expect(page.getByText('$3.25', { exact: true }).first()).toBeVisible();
    await expect(page.locator('#tab-spend')).toHaveCount(0);

    const categoryCard = page.locator('.more-settings-card').filter({
      has: page.getByRole('heading', { name: 'By category' })
    });
    await categoryCard.getByRole('button', { name: /Pantry/ }).click();
    await expect(page).toHaveURL(/\/app\/more\/insights\/prices\?month=.*category=Pantry/);
    await expect(page.locator('#price-history-title')).toBeVisible();
    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
  });

  test('records a household price with inline product and store creation entirely in React Insights', async ({ page }) => {
    await createHouseholdSession(page, 'RecordPrice');

    await page.goto('/app/more/insights/prices');
    await page.getByRole('button', { name: 'Record price', exact: true }).first().click();
    const form = page.locator('form[aria-labelledby="record-price-title"]');
    await form.getByLabel('Product').selectOption({ label: 'Add a new product…' });
    await form.getByLabel('Product name').fill('PRO-56 Recorded Item');
    await expect(form.getByLabel('Category')).toHaveValue('Other');
    await expect(form.getByLabel('Unit')).toHaveValue('each');
    await form.getByLabel('Store').selectOption({ label: 'Add a new store…' });
    await form.getByLabel('Store name').fill('PRO-56 Recorded Store');
    await form.getByLabel('Location').fill('North');
    await form.getByLabel('Regular price').fill('4.29');
    await expect(form.getByLabel('Date')).toHaveValue(/\d{4}-\d{2}-\d{2}/);
    await form.getByText('Sale or coupon details', { exact: true }).click();
    await form.getByLabel('Sale price').fill('3.99');
    await form.getByLabel('Coupon amount').fill('0.50');
    await form.getByLabel('Coupon code').fill('SAVE50');
    await expect(form.getByText('$3.49', { exact: true }).first()).toBeVisible();
    await form.getByRole('button', { name: 'Record price', exact: true }).click();

    await expect(page.getByText('Price recorded')).toBeVisible();
    const historyCard = page.locator('.more-price-card').filter({ hasText: 'PRO-56 Recorded Item' });
    await expect(historyCard).toBeVisible();
    await expect(historyCard).toContainText('PRO-56 Recorded Store');
    await expect(historyCard.locator('.more-price-card-value').getByText('$3.49', { exact: true })).toBeVisible();
    await expect(page.locator('#tab-prices')).toHaveCount(0);
  });

  test('imports reviewed CSV prices in React and replaces the same household price day', async ({ page }) => {
    await createHouseholdSession(page, 'CsvImport');
    const importDate = new Date().toISOString().slice(0, 10);
    const itemResponse = await page.request.post('/api/items', {
      data: { name: 'PRO-56 Imported Bananas', category: 'Produce', unit: 'each' }
    });
    const storeResponse = await page.request.post('/api/stores', {
      data: { name: 'PRO-56 Import Market', location: 'North' }
    });
    expect(itemResponse.ok()).toBeTruthy();
    expect(storeResponse.ok()).toBeTruthy();
    const item = await itemResponse.json();
    const store = await storeResponse.json();
    const existingPrice = await page.request.post('/api/prices', {
      data: {
        itemId: item._id,
        storeId: store._id,
        regularPrice: 9.99,
        quantity: 1,
        date: `${importDate}T12:00:00.000Z`,
        source: 'manual'
      }
    });
    expect(existingPrice.ok()).toBeTruthy();

    await page.goto('/app/more');
    await page.getByRole('link', { name: /^Import prices\b/ }).click();
    await expect(page).toHaveURL(/\/app\/more\/import$/);
    await expect(page.locator('#import-prices-title')).toHaveText('Import prices');
    await expect(page.locator('.shell-brand')).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/app\/more\/import$/);
    await expect(page.locator('#import-prices-title')).toBeVisible();

    const csv = [
      'item_name,brand,category,unit,size,store_name,final_price,is_sale,quantity,date,notes,is_organic',
      `PRO-56 Imported Banana,,Produce,each,,PRO-56 Import Market,3.49,true,1,${importDate},replacement,false`,
      `PRO-56 CSV New Item,Test Brand,Pantry,each,,PRO-56 CSV New Store,4.99,false,2,${importDate},new row,false`,
      `PRO-56 Broken Item,,Pantry,each,,PRO-56 Import Market,,false,1,${importDate},missing price,false`
    ].join('\n');
    await page.getByLabel('CSV file').setInputFiles({
      name: 'pro56-prices.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv)
    });

    await expect(page.getByRole('heading', { name: '3. Review rows' })).toBeVisible();
    await expect(page.getByText('1 ready · 2 need attention')).toBeVisible();
    const fuzzyRow = page.locator('.csv-review-row').filter({ hasText: 'PRO-56 Imported Banana' });
    await fuzzyRow.getByLabel('Match “PRO-56 Imported Banana” to').selectOption({ label: 'PRO-56 Imported Bananas' });
    const brokenRow = page.locator('.csv-review-row').filter({ hasText: 'PRO-56 Broken Item' });
    await expect(brokenRow).toContainText('final_price is required');
    await brokenRow.getByLabel('Skip this row').check();
    await expect(page.getByRole('button', { name: 'Import 2 ready rows' })).toBeEnabled();
    await page.getByRole('button', { name: 'Import 2 ready rows' }).click();

    const resultCard = page.locator('.more-settings-card').filter({ has: page.getByRole('heading', { name: 'Import result' }) });
    await expect(resultCard).toContainText('2 rows saved.');
    await expect(resultCard).toContainText('PRO-56 CSV New Item');
    await expect(resultCard).toContainText('PRO-56 CSV New Store');

    const pricesResponse = await page.request.get('/api/prices');
    expect(pricesResponse.ok()).toBeTruthy();
    const prices = await pricesResponse.json();
    const matchingPrices = prices.filter(price => {
      const itemId = price.itemId?._id || price.itemId;
      const storeId = price.storeId?._id || price.storeId;
      return itemId === item._id && storeId === store._id && String(price.date).slice(0, 10) === importDate;
    });
    expect(matchingPrices).toHaveLength(1);
    expect(matchingPrices[0].finalPrice).toBe(3.49);

    await resultCard.getByRole('button', { name: 'Open price history' }).click();
    await expect(page).toHaveURL(/\/app\/more\/insights\/prices$/);
    await expect(page.getByText('PRO-56 Imported Bananas', { exact: true })).toBeVisible();
    await expect(page.getByText('PRO-56 CSV New Item', { exact: true })).toBeVisible();
    await expect(page.locator('#csv-review-overlay')).toHaveCount(0);
  });
});
