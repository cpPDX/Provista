const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function setupFixtures() {
  const { cookie: ownerCookie } = await createOwnerSession(app);
  const itemRes = await request(app).post('/api/items').set('Cookie', ownerCookie)
    .send({ name: 'Bread', category: 'Bakery', unit: 'loaf' });
  return { ownerCookie, itemId: itemRes.body._id };
}

describe('POST /api/shopping-list', () => {
  it('owner can add item to shopping list', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const res = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body.quantity).toBe(2);
  });

  it('member can add item to shopping list', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).post('/api/shopping-list').set('Cookie', memberCookie)
      .send({ itemId, quantity: 1 });
    expect(res.status).toBe(201);
  });

  it('returns 400 when itemId is missing', async () => {
    const { ownerCookie } = await setupFixtures();
    const res = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ quantity: 1 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/shopping-list', () => {
  it('returns the household shopping list', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/shopping-list').set('Cookie', ownerCookie).send({ itemId, quantity: 1 });
    const res = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/shopping-list');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/shopping-list/:id', () => {
  it('all roles can check an item', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const added = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 1 });
    const res = await request(app).put(`/api/shopping-list/${added.body._id}`)
      .set('Cookie', ownerCookie).send({ checked: true });
    expect(res.status).toBe(200);
    expect(res.body.checked).toBe(true);
  });

  it('returns 404 when item not found', async () => {
    const { ownerCookie } = await setupFixtures();
    const res = await request(app).put('/api/shopping-list/64f0000000000000000000aa')
      .set('Cookie', ownerCookie).send({ checked: true });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/shopping-list/:id', () => {
  it('all roles can remove a specific item', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const added = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 1 });
    const res = await request(app).delete(`/api/shopping-list/${added.body._id}`)
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('DELETE /api/shopping-list (bulk)', () => {
  it('clears only checked items with ?checkedOnly=true', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const added = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 1 });
    await request(app).put(`/api/shopping-list/${added.body._id}`)
      .set('Cookie', ownerCookie).send({ checked: true });
    const res = await request(app).delete('/api/shopping-list?checkedOnly=true').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(list.body.every(i => !i.checked)).toBe(true);
  });

  it('admin can clear entire list', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/shopping-list').set('Cookie', ownerCookie).send({ itemId, quantity: 1 });
    const res = await request(app).delete('/api/shopping-list').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(list.body.length).toBe(0);
  });

  it('returns 403 when member tries to clear entire list', async () => {
    const { ownerCookie } = await setupFixtures();
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).delete('/api/shopping-list').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});
