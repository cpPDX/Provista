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
    .send({ name: 'Milk', category: 'Dairy', unit: 'gallon' });
  return { ownerCookie, itemId: itemRes.body._id };
}

describe('GET /api/inventory', () => {
  it('admin can list inventory items', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/inventory').set('Cookie', ownerCookie).send({ itemId, quantity: 2 });
    const res = await request(app).get('/api/inventory').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
  });

  it('lets a member view pantry items', async () => {
    const { ownerCookie } = await setupFixtures();
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).get('/api/inventory').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/inventory', () => {
  it('creates a new inventory item', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const res = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 3, notes: 'In fridge' });
    expect(res.status).toBe(201);
    expect(res.body.quantity).toBe(3);
    expect(res.body.notes).toBe('In fridge');
  });

  it('upserts when itemId already exists for household', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/inventory').set('Cookie', ownerCookie).send({ itemId, quantity: 1 });
    const res = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body.quantity).toBe(5);
    const list = await request(app).get('/api/inventory').set('Cookie', ownerCookie);
    expect(list.body.length).toBe(1);
  });

  it('lets a member add a routine Pantry item', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).post('/api/inventory').set('Cookie', memberCookie)
      .send({ itemId, stockStatus: 'low', quantity: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ stockStatus: 'low', quantity: 1 });
  });

  it('rejects a catalog item from another household', async () => {
    const { ownerCookie } = await setupFixtures();
    const { cookie: otherCookie } = await createOwnerSession(app);
    const foreignItem = await request(app).post('/api/items').set('Cookie', otherCookie)
      .send({ name: 'Foreign Milk', category: 'Dairy', unit: 'gallon' });
    const res = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId: foreignItem.body._id, stockStatus: 'have' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/inventory/low-stock', () => {
  it('returns items at or below lowStockThreshold', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 1 });
    await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', ownerCookie)
      .send({ lowStockThreshold: 2 });
    const res = await request(app).get('/api/inventory/low-stock').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('excludes items with null lowStockThreshold', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/inventory').set('Cookie', ownerCookie).send({ itemId, quantity: 1 });
    const res = await request(app).get('/api/inventory/low-stock').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('member can access low-stock endpoint', async () => {
    const { ownerCookie } = await setupFixtures();
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).get('/api/inventory/low-stock').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/inventory/:id', () => {
  it('admin can update quantity and lowStockThreshold', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 3 });
    const res = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', ownerCookie)
      .send({ quantity: 10, lowStockThreshold: 3 });
    expect(res.status).toBe(200);
    expect(res.body.quantity).toBe(10);
    expect(res.body.lowStockThreshold).toBe(3);
  });

  it('returns 404 when inventory item not found', async () => {
    const { ownerCookie } = await setupFixtures();
    const res = await request(app).put('/api/inventory/64f0000000000000000000aa')
      .set('Cookie', ownerCookie).send({ quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('lets a member mark an item low, out, and replenished without admin help', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 3, stockStatus: 'have' });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const low = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie)
      .send({ stockStatus: 'low' });
    const out = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie)
      .send({ stockStatus: 'out' });
    const have = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie)
      .send({ stockStatus: 'have' });

    expect(low.status).toBe(200);
    expect(low.body.stockStatus).toBe('low');
    expect(out.body).toMatchObject({ stockStatus: 'out', quantity: 0 });
    expect(have.body.stockStatus).toBe('have');
    expect(have.body.quantity).toBeGreaterThan(0);
  });

  it('lets a member adjust routine exact quantities', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 2 });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie)
      .send({ quantity: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ quantity: 4, stockStatus: 'have' });
  });
});

describe('DELETE /api/inventory/:id', () => {
  it('admin can remove an inventory item', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 2 });
    const res = await request(app).delete(`/api/inventory/${inv.body._id}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 for member', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 2 });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).delete(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});
