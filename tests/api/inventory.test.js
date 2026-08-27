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
    await request(app).post('/api/inventory').set('Cookie', ownerCookie).send({ itemId, stockStatus: 'have' });
    const res = await request(app).get('/api/inventory').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].trackingMode).toBe('simple');
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
  it('creates simple tracking when a household status is supplied', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const res = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, stockStatus: 'low', notes: 'In fridge' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ trackingMode: 'simple', stockStatus: 'low', notes: 'In fridge' });
    expect(res.body.lowStockThreshold).toBeNull();
  });

  it('creates exact tracking when quantity is the supplied source of truth', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const res = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 3, lowStockThreshold: 3 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ trackingMode: 'exact', quantity: 3, lowStockThreshold: 3, stockStatus: 'low' });
  });

  it('rejects competing stockStatus in exact mode', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const res = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, trackingMode: 'exact', quantity: 3, lowStockThreshold: 1, stockStatus: 'out' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/derives stock status/i);
  });

  it('upserts when itemId already exists for household', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/inventory').set('Cookie', ownerCookie).send({ itemId, trackingMode: 'exact', quantity: 1 });
    const res = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, trackingMode: 'exact', quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ trackingMode: 'exact', quantity: 5 });
    const list = await request(app).get('/api/inventory').set('Cookie', ownerCookie);
    expect(list.body).toHaveLength(1);
  });

  it('lets a member add a routine simple Pantry item', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).post('/api/inventory').set('Cookie', memberCookie)
      .send({ itemId, trackingMode: 'simple', stockStatus: 'low' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ trackingMode: 'simple', stockStatus: 'low' });
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
  it('returns exact items at or below their low-stock threshold', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, trackingMode: 'exact', quantity: 1, lowStockThreshold: 2 });
    const res = await request(app).get('/api/inventory/low-stock').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ trackingMode: 'exact', stockStatus: 'low', quantity: 1, lowStockThreshold: 2 });
  });

  it('returns simple items manually marked low without inventing a threshold', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, trackingMode: 'simple', stockStatus: 'low' });
    const res = await request(app).get('/api/inventory/low-stock').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ trackingMode: 'simple', stockStatus: 'low' });
    expect(res.body[0].lowStockThreshold).toBeNull();
  });

  it('excludes healthy simple items', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, trackingMode: 'simple', stockStatus: 'have' });
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
  it('legacy quantity/threshold edits resolve to exact tracking', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, trackingMode: 'simple', stockStatus: 'have' });
    const res = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', ownerCookie)
      .send({ quantity: 10, lowStockThreshold: 3 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ trackingMode: 'exact', quantity: 10, lowStockThreshold: 3, stockStatus: 'have' });
  });

  it('returns 404 when inventory item not found', async () => {
    const { ownerCookie } = await setupFixtures();
    const res = await request(app).put('/api/inventory/64f0000000000000000000aa')
      .set('Cookie', ownerCookie).send({ quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('lets a member change simple status without manipulating exact quantity', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, trackingMode: 'simple', stockStatus: 'have' });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const low = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie)
      .send({ trackingMode: 'simple', stockStatus: 'low' });
    const out = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie)
      .send({ trackingMode: 'simple', stockStatus: 'out' });
    const have = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie)
      .send({ trackingMode: 'simple', stockStatus: 'have' });

    expect(low.status).toBe(200);
    expect(low.body.stockStatus).toBe('low');
    expect(out.body).toMatchObject({ trackingMode: 'simple', stockStatus: 'out', quantity: 0 });
    expect(have.body.stockStatus).toBe('have');
    expect(have.body.quantity).toBeGreaterThan(0);
  });

  it('lets a member adjust exact quantities and derives status', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, trackingMode: 'exact', quantity: 2, lowStockThreshold: 2 });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie)
      .send({ trackingMode: 'exact', quantity: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ trackingMode: 'exact', quantity: 4, stockStatus: 'have' });
  });

  it('switches exact tracking back to simple with one explicit status', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, trackingMode: 'exact', quantity: 2, lowStockThreshold: 3 });
    const res = await request(app).put(`/api/inventory/${inv.body._id}`).set('Cookie', ownerCookie)
      .send({ trackingMode: 'simple', stockStatus: 'have' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ trackingMode: 'simple', stockStatus: 'have' });
    expect(res.body.lowStockThreshold).toBeNull();
  });
});

describe('DELETE /api/inventory/:id', () => {
  it('admin can remove an inventory item', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, stockStatus: 'have' });
    const res = await request(app).delete(`/api/inventory/${inv.body._id}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 for member', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const inv = await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, stockStatus: 'have' });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).delete(`/api/inventory/${inv.body._id}`).set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});
