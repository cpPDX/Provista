// Shared login helper for E2E tests.
//
// Registration is cached at module level so seedHousehold() only runs once
// per Playwright worker (= once per spec file). Subsequent beforeEach calls
// skip the slow API registration and only do the fast browser UI login.
const { request } = require('@playwright/test');

let _counter = 0;
function uid() { return `${Date.now()}-${process.pid}-${++_counter}`; }

let _credentials = null; // cached per worker / spec file

/**
 * Logs into the app as a test user.
 * First call: registers a new user+household via API (slow — triggers seedHousehold),
 * then logs in via the browser UI.
 * Subsequent calls: skips registration, only does the browser UI login.
 */
async function loginAsNewUser(page, baseURL) {
  if (!_credentials) {
    const email = `e2e-${uid()}@test.com`;
    const password = 'password123';

    // Create user via API — only once per worker
    const apiReq = await request.newContext({ baseURL });
    const res = await apiReq.post('/api/auth/register', {
      data: { name: 'E2E User', email, password, action: 'create', householdName: 'E2E House' }
    });
    if (!res.ok()) throw new Error(`API register failed: ${await res.text()}`);
    await apiReq.dispose();

    _credentials = { email, password };
  }

  // Log in via browser (fast)
  await page.goto('/login.html');
  const loginForm = page.locator('#login-form');
  await loginForm.locator('input[name="email"]').fill(_credentials.email);
  await loginForm.locator('input[name="password"]').fill(_credentials.password);
  await loginForm.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('/', { timeout: 15000 });

  return { ..._credentials };
}

/**
 * Adds a normal member to the owner household currently open in `page`, then
 * signs the browser into that member account.
 */
async function loginAsHouseholdMember(page, baseURL) {
  const inviteResponse = await page.request.get('/api/household/invite');
  if (!inviteResponse.ok()) throw new Error(`Invite lookup failed: ${await inviteResponse.text()}`);
  const { inviteCode } = await inviteResponse.json();
  const email = `e2e-member-${uid()}@test.com`;
  const password = 'password123';
  const apiReq = await request.newContext({ baseURL });
  const register = await apiReq.post('/api/auth/register', {
    data: { name: 'E2E Member', email, password, action: 'join', inviteCode }
  });
  if (!register.ok()) throw new Error(`Member register failed: ${await register.text()}`);
  await apiReq.dispose();

  await page.goto('/login.html');
  await page.locator('#login-form input[name="email"]').fill(email);
  await page.locator('#login-form input[name="password"]').fill(password);
  await page.locator('#login-form').getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('/', { timeout: 15000 });
  return { email, password };
}

module.exports = { loginAsNewUser, loginAsHouseholdMember };
