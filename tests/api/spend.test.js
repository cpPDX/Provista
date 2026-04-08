const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function setupAndCreateEntry(month) {
  const { cookie: ownerCookie } = await createOwnerSession(app);
  const storeRes = await request(app).post('/api/stores').set('Cookie', ownerCookie).send({ name: 'Costco' });
  const itemRes = await request(app).post('/api/items').set('Cookie', ownerCookie)
    .send({ name: 'Eggs', category: 'Dairy', unit: 'dozen' });
  const dateStr = month ? `${month}-15T12:00:00.000Z` : new Date().toISOString();
  await request(app).post('/api/prices').set('Cookie', ownerCookie).send({
    itemId: itemRes.body._id,
    storeId: storeRes.body._id,
    regularPrice: 5.99,
    quantity: 1,
    date: dateStr
  });
  return { ownerCookie, month: month || new Date().toISOString().slice(0, 7) };
}

describe('GET /api/spend', () => {
  it('returns total, byCategory, and byStore for the current month', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { ownerCookie } = await setupAndCreateEntry(currentMonth);
    const res = await request(app).get(`/api/spend?month=${currentMonth}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.total).toBeCloseTo(5.99);
    expect(Array.isArray(res.body.byCategory)).toBe(true);
    expect(Array.isArray(res.body.byStore)).toBe(true);
  });

  it('returns zero totals when no entries exist for that month', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/spend?month=2000-01').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.byCategory).toEqual([]);
    expect(res.body.byStore).toEqual([]);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/spend');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/spend/summary', () => {
  it('returns array of month totals', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const { ownerCookie } = await setupAndCreateEntry(currentMonth);
    const res = await request(app).get('/api/spend/summary').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('month');
      expect(res.body[0]).toHaveProperty('total');
    }
  });

  it('returns empty array when no data', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/spend/summary').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
