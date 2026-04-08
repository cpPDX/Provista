// Shared login helper for E2E tests.
// Creates a unique user via API and logs in via the UI.
const { request } = require('@playwright/test');

let _counter = 0;
function uid() { return `${Date.now()}-${++_counter}`; }

/**
 * Creates a test user+household via API and logs in via the browser UI.
 * Returns the user credentials so they can be reused in subsequent pages.
 */
async function loginAsNewUser(page, baseURL) {
  const email = `e2e-${uid()}@test.com`;
  const password = 'password123';

  // Create user via API
  const apiReq = await request.newContext({ baseURL });
  const res = await apiReq.post('/api/auth/register', {
    data: { name: 'E2E User', email, password, action: 'create', householdName: 'E2E House' }
  });
  if (!res.ok()) throw new Error(`API register failed: ${await res.text()}`);
  await apiReq.dispose();

  // Log in via browser
  await page.goto('/login.html');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#btn-login');
  await page.waitForURL('/', { timeout: 10000 });

  return { email, password };
}

module.exports = { loginAsNewUser };
