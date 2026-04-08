const request = require('supertest');

// Creates a new household owner and returns the supertest cookie + user info.
// Uses a unique email per call to avoid collisions between tests.
let _counter = 0;
function uid() { return `${Date.now()}-${++_counter}`; }

async function createOwnerSession(app, overrides = {}) {
  const email = overrides.email || `owner-${uid()}@test.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      name: overrides.name || 'Test Owner',
      email,
      password: overrides.password || 'password123',
      action: 'create',
      householdName: overrides.householdName || 'Test Household'
    });
  if (res.status !== 201) throw new Error(`createOwnerSession failed: ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'][0];
  return { cookie, user: res.body.user };
}

// Gets the current invite code for a household (owner/admin cookie required).
async function getInviteCode(app, ownerCookie) {
  const res = await request(app)
    .get('/api/household/invite')
    .set('Cookie', ownerCookie);
  if (res.status !== 200) throw new Error(`getInviteCode failed: ${JSON.stringify(res.body)}`);
  return res.body.inviteCode;
}

// Joins an existing household as a member using an invite code.
async function createMemberSession(app, inviteCode, overrides = {}) {
  const email = overrides.email || `member-${uid()}@test.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      name: overrides.name || 'Test Member',
      email,
      password: overrides.password || 'password123',
      action: 'join',
      inviteCode
    });
  if (res.status !== 201) throw new Error(`createMemberSession failed: ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'][0];
  return { cookie, user: res.body.user };
}

module.exports = { createOwnerSession, createMemberSession, getInviteCode };
