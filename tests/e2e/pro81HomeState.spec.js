const { test, expect } = require('@playwright/test');
const { loginAsReactHomeUser } = require('./helpers/login');

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekStart() {
  const date = new Date();
  date.setDate(date.getDate() - date.getDay());
  return dateKey(date);
}

function daysForWeek(start, dinnerName = '') {
  const [year, month, day] = start.split('-').map(Number);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(year, month - 1, day + index);
    const today = dateKey(date) === dateKey();
    return {
      date: `${dateKey(date)}T00:00:00.000Z`,
      meals: [{ mealType: 'dinner', personName: '', personIds: [], forEveryone: true, name: today ? dinnerName : '', notes: '' }]
    };
  });
}

async function seedDinner(page, name) {
  const start = weekStart();
  expect((await page.request.put('/api/meal-plan/settings', { data: { weekStartDay: 0, mealPlanMode: 'dinner' } })).ok()).toBeTruthy();
  expect((await page.request.put('/api/meal-plan', { data: { weekStart: start, days: daysForWeek(start, name), produceNotes: '', shoppingNotes: '' } })).ok()).toBeTruthy();
}

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 }
]) {
  test(`keeps Home dinner actions consistent on ${viewport.name}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loginAsReactHomeUser(page, baseURL);
    await seedDinner(page, '');
    await page.goto('/app');

    await expect(page.getByRole('button', { name: 'Plan dinner', exact: true })).toBeVisible();
    await expect(page.locator('.home-react-card', { hasText: 'What’s for dinner?' })).toContainText('Dinner isn’t planned yet');

    await seedDinner(page, 'Taco bowls');
    await page.reload();

    const dinnerCard = page.locator('.home-react-card', { hasText: 'What’s for dinner?' });
    await expect(dinnerCard).toContainText('Taco bowls');
    await expect(dinnerCard).toContainText('Tonight’s plan is ready.');
    await expect(page.getByRole('button', { name: 'Plan dinner', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View tonight', exact: true })).toBeVisible();
  });
}
