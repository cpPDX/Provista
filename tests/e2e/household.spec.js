const { test, expect, request } = require('@playwright/test');
const { loginAsNewUser } = require('./helpers/login');

async function openHousehold(page) {
  await page.click('[data-tab="more"]');
  await page.locator('.more-item[data-section="household"]').click();
  await expect(page.locator('#household-content')).toBeVisible();
  await expect(page.locator('#household-roster-section')).toBeVisible();
}

async function addAccountMember(page, baseURL) {
  const inviteResponse = await page.request.get('/api/household/invite');
  expect(inviteResponse.ok()).toBeTruthy();
  const { inviteCode } = await inviteResponse.json();
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const email = `household-member-${suffix}@test.com`;
  const apiRequest = await request.newContext({ baseURL });
  try {
    const response = await apiRequest.post('/api/auth/register', {
      data: {
        name: `Household Member ${suffix}`,
        displayName: `Member ${suffix}`,
        email,
        password: 'password123',
        action: 'join',
        inviteCode
      }
    });
    expect(response.ok()).toBeTruthy();
  } finally {
    await apiRequest.dispose();
  }

  const householdResponse = await page.request.get('/api/household');
  expect(householdResponse.ok()).toBeTruthy();
  const household = await householdResponse.json();
  const member = household.members.find(entry => entry.email === email);
  expect(member).toBeTruthy();
  return member;
}

test.describe('Household management', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async text => { window.__copiedInviteCode = text; }
        }
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async data => { window.__sharedInvite = data; }
      });
    });
    await loginAsNewUser(page, baseURL);
  });

  test('shows account-backed and planning-only people once in one household roster', async ({ page, baseURL }) => {
    const accountMember = await addAccountMember(page, baseURL);
    await openHousehold(page);

    await expect(page.locator('#household-roster-section h2')).toHaveText('Our household');
    await expect(page.locator('#household-content h2', { hasText: /^Accounts/ })).toHaveCount(0);
    await expect(page.locator('#household-content h2', { hasText: /^People/ })).toHaveCount(0);

    const ownerRow = page.locator('#household-roster-list .member-card', { hasText: '(you)' });
    await expect(ownerRow).toContainText('Owner · Can sign in');

    const memberName = accountMember.displayName || accountMember.name.split(/\s+/)[0];
    const memberRow = page.locator('#household-roster-list .member-card', { hasText: memberName });
    await expect(memberRow).toHaveCount(1);
    await expect(memberRow).toContainText('Member · Can sign in');

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.locator('#new-household-person-name').fill('Wiz Planning');
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    await expect(page.locator('#modal-overlay')).toBeHidden();

    const planningRow = page.locator('#household-roster-list .member-card', { hasText: 'Wiz Planning' });
    await expect(planningRow).toHaveCount(1);
    await expect(planningRow).toContainText('Planning only');
    await expect(planningRow).not.toContainText('Can sign in');
  });

  test('role, access, and planning-person removal use explicit Provista confirmations', async ({ page, baseURL }) => {
    const accountMember = await addAccountMember(page, baseURL);
    await openHousehold(page);

    const memberName = accountMember.displayName || accountMember.name.split(/\s+/)[0];
    const memberRow = page.locator('#household-roster-list .member-card', { hasText: memberName });
    await memberRow.getByRole('button', { name: 'Make Admin' }).click();
    let dialog = page.getByRole('dialog', { name: `Make ${memberName} an Admin?` });
    await expect(dialog).toContainText('manage household settings, stores, products, and invites');
    await expect(dialog).toContainText('account stays in the household');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await memberRow.getByRole('button', { name: 'Remove access' }).click();
    dialog = page.getByRole('dialog', { name: `Remove ${memberName}’s household access?` });
    await expect(dialog).toContainText('no longer be able to sign in');
    await expect(dialog).toContainText('shopping history, Pantry data, and household records stay');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: '+ Add person' }).click();
    await page.locator('#new-household-person-name').fill('Planning Remove');
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    const planningRow = page.locator('#household-roster-list .member-card', { hasText: 'Planning Remove' });
    await planningRow.getByRole('button', { name: 'Remove person' }).click();
    dialog = page.getByRole('dialog', { name: 'Remove Planning Remove from planning?' });
    await expect(dialog).toContainText('Products, Pantry, shopping history, and account access are not deleted');
    await dialog.getByRole('button', { name: 'Remove person' }).click();
    await expect(page.locator('#modal-overlay')).toBeHidden();
    await expect(page.locator('#household-roster-list .member-card', { hasText: 'Planning Remove' })).toHaveCount(0);
  });

  test('invite workflow makes sharing primary and confirms regeneration', async ({ page }) => {
    await openHousehold(page);
    await page.getByRole('button', { name: 'Show invite' }).click();

    const inviteCode = (await page.locator('.invite-code-value').textContent()).trim();
    await expect(page.getByRole('button', { name: 'Share invite' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerate code' })).toBeVisible();
    await expect(page.locator('.qr-img')).toBeVisible();

    await page.getByRole('button', { name: 'Copy code' }).click();
    await expect.poll(() => page.evaluate(() => window.__copiedInviteCode)).toBe(inviteCode);
    await expect(page.locator('#toast')).toContainText('Invite code copied');

    await page.getByRole('button', { name: 'Share invite' }).click();
    const shared = await page.evaluate(() => window.__sharedInvite);
    expect(shared.text).toContain(inviteCode);

    await page.getByRole('button', { name: 'Regenerate code' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create a new invite code?' });
    await expect(dialog).toContainText('The current invite code will stop working.');
    await expect(dialog.getByRole('button', { name: 'Create new code' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.invite-code-value')).toHaveText(inviteCode);
  });

  test('keeps common shopping defaults primary and technical price controls advanced', async ({ page }) => {
    await openHousehold(page);

    await expect(page.getByLabel('Usual store')).toBeVisible();
    await expect(page.getByLabel('Suggest another store when we’d save at least ($)')).toBeVisible();

    const advanced = page.locator('.household-advanced-settings');
    await expect(advanced).toBeVisible();
    await expect(advanced).not.toHaveAttribute('open', '');
    await advanced.locator('summary').click();
    await expect(page.getByLabel('Ignore prices older than… (days)')).toBeVisible();
    await expect(page.getByText('Require Admin approval for shopping prices', { exact: true })).toBeVisible();
  });
});
