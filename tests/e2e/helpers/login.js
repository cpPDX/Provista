// Shared login helper for E2E tests.
//
// Registration is cached at module level so seedHousehold() only runs once
// per Playwright worker (= once per spec file). Subsequent beforeEach calls
// skip the slow API registration and only do the fast browser UI login.
const { request } = require('@playwright/test');

let _counter = 0;
function uid() { return `${Date.now()}-${process.pid}-${++_counter}`; }

let _credentials = null; // cached per worker / spec file

async function ensureCredentials(baseURL) {
  if (_credentials) return _credentials;

  const email = `e2e-${uid()}@test.com`;
  const password = 'password123';
  const apiReq = await request.newContext({ baseURL });
  const res = await apiReq.post('/api/auth/register', {
    data: { name: 'E2E User', email, password, action: 'create', householdName: 'E2E House' }
  });
  if (!res.ok()) throw new Error(`API register failed: ${await res.text()}`);
  await apiReq.dispose();

  _credentials = { email, password };
  return _credentials;
}

async function loginThroughBrowser(page, baseURL) {
  const credentials = await ensureCredentials(baseURL);
  await page.goto('/login.html');
  const loginForm = page.locator('#login-form');
  await loginForm.locator('input[name="email"]').fill(credentials.email);
  await loginForm.locator('input[name="password"]').fill(credentials.password);
  await loginForm.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('/', { timeout: 15000 });
  return credentials;
}

/**
 * Logs into the legacy compatibility surface. Existing feature specs keep
 * using this helper until their feature is migrated to React.
 */
async function loginAsNewUser(page, baseURL) {
  const credentials = await loginThroughBrowser(page, baseURL);
  await page.goto('/legacy-app');
  await page.waitForSelector('#tab-home.active');
  return { ...credentials };
}

/**
 * Logs into the production React Home surface. Use this for migrated Home and
 * shell coverage so tests exercise the same entry point returning users see.
 */
async function loginAsReactHomeUser(page, baseURL) {
  const credentials = await loginThroughBrowser(page, baseURL);
  await page.waitForSelector('#home-react-title');
  return { ...credentials };
}

/**
 * Adds a normal member to the owner household currently open in `page`, then
 * signs the browser into that member account on the legacy compatibility app.
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
  await page.goto('/legacy-app');
  await page.waitForSelector('#tab-home.active');
  return { email, password };
}

module.exports = { loginAsNewUser, loginAsReactHomeUser, loginAsHouseholdMember };
