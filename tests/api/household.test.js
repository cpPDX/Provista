const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const HouseholdPerson = require('../../models/HouseholdPerson');
const FavoriteMeal = require('../../models/FavoriteMeal');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

describe('GET /api/household', () => {
  it('returns household info, account members, and planning people', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/household').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.household).toBeDefined();
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.members.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.people)).toBe(true);
    expect(res.body.people.length).toBeGreaterThan(0);
    expect(res.body.people[0].displayName).toBeTruthy();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/household');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/household', () => {
  it('owner can rename household', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .put('/api/household')
      .set('Cookie', cookie)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
  });

  it('returns 400 when name is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/household').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });

  it('returns 403 when member tries to rename', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .put('/api/household')
      .set('Cookie', memberCookie)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });
});

describe('household people', () => {
  it('owner can add a person without creating a user account', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .post('/api/household/people')
      .set('Cookie', cookie)
      .send({ displayName: 'Wiz' });

    expect(res.status).toBe(201);
    expect(res.body.displayName).toBe('Wiz');
    expect(res.body.userId).toBeNull();

    const household = await request(app).get('/api/household').set('Cookie', cookie);
    expect(household.body.people.some(p => p.displayName === 'Wiz')).toBe(true);
  });

  it('backfills a missing account-linked person even when manual people already exist', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const manual = await request(app)
      .post('/api/household/people')
      .set('Cookie', ownerCookie)
      .send({ displayName: 'Kid' });
    expect(manual.status).toBe(201);

    const code = await getInviteCode(app, ownerCookie);
    const { user: member } = await createMemberSession(app, code);
    await HouseholdPerson.deleteOne({ userId: member._id });

    const household = await request(app).get('/api/household').set('Cookie', ownerCookie);
    expect(household.status).toBe(200);
    expect(household.body.people.some(p => p._id === manual.body._id)).toBe(true);
    expect(household.body.people.some(p => String(p.userId) === String(member._id))).toBe(true);
  });

  it('member cannot add household people', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const res = await request(app)
      .post('/api/household/people')
      .set('Cookie', memberCookie)
      .send({ displayName: 'Kid' });
    expect(res.status).toBe(403);
  });

  it('owner can rename a household person', async () => {
    const { cookie } = await createOwnerSession(app);
    const created = await request(app)
      .post('/api/household/people')
      .set('Cookie', cookie)
      .send({ displayName: 'Kid' });

    const res = await request(app)
      .put(`/api/household/people/${created.body._id}`)
      .set('Cookie', cookie)
      .send({ displayName: 'Wiz' });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Wiz');
  });

  it('owner can remove a non-account household person from planning', async () => {
    const { cookie } = await createOwnerSession(app);
    const created = await request(app)
      .post('/api/household/people')
      .set('Cookie', cookie)
      .send({ displayName: 'Guest' });

    const remove = await request(app)
      .delete(`/api/household/people/${created.body._id}`)
      .set('Cookie', cookie);
    expect(remove.status).toBe(200);

    const household = await request(app).get('/api/household').set('Cookie', cookie);
    expect(household.body.people.some(p => p._id === created.body._id)).toBe(false);
  });

  it('does not allow deleting an account-linked person through the people endpoint', async () => {
    const { cookie } = await createOwnerSession(app);
    const household = await request(app).get('/api/household').set('Cookie', cookie);
    const linkedPerson = household.body.people.find(p => p.userId);
    expect(linkedPerson).toBeDefined();

    const res = await request(app)
      .delete(`/api/household/people/${linkedPerson._id}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/household/invite', () => {
  it('returns inviteCode for owner', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/household/invite').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.inviteCode).toBeTruthy();
    expect(res.body.expiresAt).toBeTruthy();
  });

  it('returns 403 for member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).get('/api/household/invite').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/household/invite', () => {
  it('owner can regenerate invite code', async () => {
    const { cookie } = await createOwnerSession(app);
    const first = await request(app).get('/api/household/invite').set('Cookie', cookie);
    const res = await request(app).post('/api/household/invite').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.inviteCode).not.toBe(first.body.inviteCode);
  });

  it('returns 403 for member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).post('/api/household/invite').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/household/members/:id', () => {
  it('owner can remove a member while preserving them as a household person', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { user: member } = await createMemberSession(app, code);

    const before = await request(app).get('/api/household').set('Cookie', ownerCookie);
    const memberPerson = before.body.people.find(p => String(p.userId) === String(member._id));
    expect(memberPerson).toBeDefined();

    const res = await request(app)
      .delete(`/api/household/members/${member._id}`)
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const after = await request(app).get('/api/household').set('Cookie', ownerCookie);
    expect(after.body.members.some(m => m._id === member._id)).toBe(false);
    const preserved = after.body.people.find(p => p._id === memberPerson._id);
    expect(preserved).toBeDefined();
    expect(preserved.userId).toBeNull();
  });

  it('returns 404 when member not found', async () => {
    const { cookie } = await createOwnerSession(app);
    const fakeId = '64f0000000000000000000aa';
    const res = await request(app).delete(`/api/household/members/${fakeId}`).set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  it('returns 403 for member role', async () => {
    const { cookie: ownerCookie, user: owner } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .delete(`/api/household/members/${owner._id}`)
      .set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/household/members/:id', () => {
  it('owner can promote member to admin', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { user: member } = await createMemberSession(app, code);
    const res = await request(app)
      .put(`/api/household/members/${member._id}`)
      .set('Cookie', ownerCookie)
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  it('returns 400 when role is invalid', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { user: member } = await createMemberSession(app, code);
    const res = await request(app)
      .put(`/api/household/members/${member._id}`)
      .set('Cookie', ownerCookie)
      .send({ role: 'superadmin' });
    expect(res.status).toBe(400);
  });

  it('returns 403 when called by member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const { user: member2 } = await createMemberSession(app, code);
    const res = await request(app)
      .put(`/api/household/members/${member2._id}`)
      .set('Cookie', memberCookie)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/household', () => {
  it('owner can delete household with correct password', async () => {
    const { cookie, user } = await createOwnerSession(app);
    const favorite = await request(app)
      .post('/api/meal-plan/favorites')
      .set('Cookie', cookie)
      .send({ name: 'Household tacos', notes: 'tortillas, salsa' });
    expect(favorite.status).toBe(200);

    const res = await request(app)
      .delete('/api/household')
      .set('Cookie', cookie)
      .send({ password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(await FavoriteMeal.countDocuments({ householdId: user.householdId })).toBe(0);
  });

  it('returns 401 with wrong password', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .delete('/api/household')
      .set('Cookie', cookie)
      .send({ password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when password is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).delete('/api/household').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });

  it('returns 403 when called by member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .delete('/api/household')
      .set('Cookie', memberCookie)
      .send({ password: 'password123' });
    expect(res.status).toBe(403);
  });
});
