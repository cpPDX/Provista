const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function setupFixtures(app) {
  const { cookie: ownerCookie } = await createOwnerSession(app);
  const storeRes = await request(app).post('/api/stores').set('Cookie', ownerCookie).send({ name: 'Safeway' });
  const itemRes = await request(app).post('/api/items').set('Cookie', ownerCookie)
    .send({ name: 'Milk', category: 'Dairy', unit: 'gallon' });
  return { ownerCookie, storeId: storeRes.body._id, itemId: itemRes.body._id };
}

function pricePayload(itemId, storeId, overrides = {}) {
  return { itemId, storeId, regularPrice: 3.99, quantity: 1, date: new Date().toISOString(), ...overrides };
}

describe('POST /api/prices', () => {
  it('admin creates entry with status approved', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const res = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('approved');
    expect(res.body.finalPrice).toBeCloseTo(3.99);
  });

  it('member creates entry with status pending', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).post('/api/prices').set('Cookie', memberCookie)
      .send(pricePayload(itemId, storeId));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
  });

  it('correctly applies salePrice when lower than regularPrice', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const res = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId, { salePrice: 2.99 }));
    expect(res.status).toBe(201);
    expect(res.body.finalPrice).toBeCloseTo(2.99);
  });

  it('ignores salePrice when higher than regularPrice', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const res = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId, { salePrice: 5.99 }));
    expect(res.status).toBe(201);
    expect(res.body.finalPrice).toBeCloseTo(3.99);
  });

  it('deducts couponAmount from finalPrice', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const res = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId, { couponAmount: 0.50 }));
    expect(res.status).toBe(201);
    expect(res.body.finalPrice).toBeCloseTo(3.49);
  });

  it('calculates pricePerUnit as finalPrice / quantity', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const res = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId, { regularPrice: 4.00, quantity: 2 }));
    expect(res.status).toBe(201);
    expect(res.body.pricePerUnit).toBeCloseTo(2.0);
  });
});

describe('GET /api/prices', () => {
  it('returns only approved entries', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    // Admin creates approved
    await request(app).post('/api/prices').set('Cookie', ownerCookie).send(pricePayload(itemId, storeId));
    // Member creates pending
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    await request(app).post('/api/prices').set('Cookie', memberCookie).send(pricePayload(itemId, storeId));

    const res = await request(app).get('/api/prices').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.every(e => e.status === 'approved')).toBe(true);
  });

  it('filters by itemId', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    await request(app).post('/api/prices').set('Cookie', ownerCookie).send(pricePayload(itemId, storeId));
    const res = await request(app).get(`/api/prices?itemId=${itemId}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.every(e => e.itemId._id === itemId || e.itemId === itemId)).toBe(true);
  });
});

describe('GET /api/prices/pending', () => {
  it('admin can see pending entries', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    await request(app).post('/api/prices').set('Cookie', memberCookie).send(pricePayload(itemId, storeId));
    const res = await request(app).get('/api/prices/pending').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].status).toBe('pending');
  });

  it('returns 403 for member', async () => {
    const { ownerCookie } = await setupFixtures(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).get('/api/prices/pending').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/prices/:id/approve', () => {
  it('approves a pending entry', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const pendingRes = await request(app).post('/api/prices').set('Cookie', memberCookie)
      .send(pricePayload(itemId, storeId));
    const res = await request(app)
      .put(`/api/prices/${pendingRes.body._id}/approve`)
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  it('returns 403 for member', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const pending = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId));
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .put(`/api/prices/${pending.body._id}/approve`)
      .set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/prices/:id/reject', () => {
  it('admin can reject a pending entry', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const pendingRes = await request(app).post('/api/prices').set('Cookie', memberCookie)
      .send(pricePayload(itemId, storeId));
    const res = await request(app)
      .delete(`/api/prices/${pendingRes.body._id}/reject`)
      .set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 for member', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const pending = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId));
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .delete(`/api/prices/${pending.body._id}/reject`)
      .set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/prices/:id', () => {
  it('admin can delete an approved entry', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const entry = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId));
    const res = await request(app).delete(`/api/prices/${entry.body._id}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 for member', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const entry = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId));
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).delete(`/api/prices/${entry.body._id}`).set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/prices/history/:itemId', () => {
  it('returns approved entries for the item', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    await request(app).post('/api/prices').set('Cookie', ownerCookie).send(pricePayload(itemId, storeId));
    const res = await request(app).get(`/api/prices/history/${itemId}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('GET /api/prices/compare/:itemId', () => {
  it('returns latest approved price per store sorted by pricePerUnit', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    await request(app).post('/api/prices').set('Cookie', ownerCookie).send(pricePayload(itemId, storeId));
    const res = await request(app).get(`/api/prices/compare/${itemId}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns empty array when no approved entries exist', async () => {
    const { ownerCookie, itemId } = await setupFixtures(app);
    const res = await request(app).get(`/api/prices/compare/${itemId}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
