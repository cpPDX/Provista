// Shared login helper for React E2E tests.
//
// Registration is cached per Playwright project/spec/repeat so tests within one
// spec reuse credentials without leaking household state across suites.
const { request, test } = require('@playwright/test');

let _counter = 0;
function uid() { return `${Date.now()}-${process.pid}-${++_counter}`; }

const _credentialsBySpec = new Map();

function credentialScope() {
  const info = test.info();
  return `${info.project.name}:${info.file}:${info.repeatEachIndex}`;
}

async function ensureCredentials(baseURL) {
  const scope = credentialScope();
  const cached = _credentialsBySpec.get(scope);
  if (cached) return cached;

  const email = `e2e-${uid()}@test.com`;
  const password = 'password123';
  const apiReq = await request.newContext({ baseURL });
  const res = await apiReq.post('/api/auth/register', {
    data: { name: 'E2E User', email, password, action: 'create', householdName: 'E2E House' }
  });
  if (!res.ok()) throw new Error(`API register failed: ${await res.text()}`);
  await apiReq.dispose();

  const credentials = { email, password };
  _credentialsBySpec.set(scope, credentials);
  return credentials;
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

async function loginAsReactHomeUser(page, baseURL) {
  const credentials = await loginThroughBrowser(page, baseURL);
  await page.waitForSelector('#home-react-title');
  return { ...credentials };
}

module.exports = { loginAsReactHomeUser };
