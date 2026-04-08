const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function createStore(cookie, overrides = {}) {
  return request(app)
    .post('/api/stores')
    .set('Cookie', cookie)
    .send({ name: 'Test Store', ...overrides });
}

describe('POST /api/stores', () => {
  it('owner can create a store', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await createStore(cookie);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Store');
  });

  it('member can create a store', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await createStore(memberCookie);
    expect(res.status).toBe(201);
  });

  it('returns 400 when name is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).post('/api/stores').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/stores', () => {
  it('returns stores for the household', async () => {
    const { cookie } = await createOwnerSession(app);
    await createStore(cookie);
    const res = await request(app).get('/api/stores').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/stores');
    expect(res.status).toBe(401);
  });

  it('does not return stores from other households', async () => {
    const { cookie: cookie1 } = await createOwnerSession(app);
    const { cookie: cookie2 } = await createOwnerSession(app);
    await createStore(cookie1, { name: 'House1 Store' });
    const res = await request(app).get('/api/stores').set('Cookie', cookie2);
    expect(res.status).toBe(200);
    expect(res.body.every(s => s.name !== 'House1 Store')).toBe(true);
  });
});

describe('PUT /api/stores/:id', () => {
  it('admin can update store name', async () => {
    const { cookie } = await createOwnerSession(app);
    const { body: store } = await createStore(cookie);
    const res = await request(app)
      .put(`/api/stores/${store._id}`)
      .set('Cookie', cookie)
      .send({ name: 'Updated Store' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Store');
  });

  it('returns 403 when called by member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const { body: store } = await createStore(ownerCookie);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .put(`/api/stores/${store._id}`)
      .set('Cookie', memberCookie)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when store not found', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .put('/api/stores/64f0000000000000000000aa')
      .set('Cookie', cookie)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/stores/:id', () => {
  it('admin can delete a store', async () => {
    const { cookie } = await createOwnerSession(app);
    const { body: store } = await createStore(cookie);
    const res = await request(app).delete(`/api/stores/${store._id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 when called by member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const { body: store } = await createStore(ownerCookie);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).delete(`/api/stores/${store._id}`).set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});
