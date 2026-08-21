const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function createOwnerWithItem(prefix) {
  const { cookie } = await createOwnerSession(app, { email: `${prefix}@test.com` });
  const item = await request(app).post('/api/items').set('Cookie', cookie)
    .send({ name: `${prefix} Staple`, category: 'Pantry', unit: 'each' });
  return { cookie, itemId: item.body._id };
}

describe('collaborative Pantry scoping', () => {
  it('rejects a catalog item from another household', async () => {
    const a = await createOwnerWithItem('pantry-a');
    const b = await createOwnerWithItem('pantry-b');
    const code = await getInviteCode(app, a.cookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const res = await request(app).post('/api/inventory').set('Cookie', memberCookie)
      .send({ itemId: b.itemId, quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('does not allow relationship fields to be reassigned through update', async () => {
    const a = await createOwnerWithItem('pantry-a');
    const b = await createOwnerWithItem('pantry-b');
    const created = await request(app).post('/api/inventory').set('Cookie', a.cookie)
      .send({ itemId: a.itemId, quantity: 1 });

    const res = await request(app).put(`/api/inventory/${created.body._id}`).set('Cookie', a.cookie)
      .send({ itemId: b.itemId, householdId: '64f0000000000000000000aa' });
    expect(res.status).toBe(400);

    const pantry = await request(app).get('/api/inventory').set('Cookie', a.cookie);
    expect(String(pantry.body[0].itemId._id)).toBe(String(a.itemId));
  });

  it('keeps a zero-quantity staple visible when it has a keep-on-hand threshold', async () => {
    const a = await createOwnerWithItem('pantry-a');
    await request(app).post('/api/inventory').set('Cookie', a.cookie)
      .send({ itemId: a.itemId, quantity: 0, lowStockThreshold: 1 });

    const pantry = await request(app).get('/api/inventory').set('Cookie', a.cookie);
    expect(pantry.status).toBe(200);
    expect(pantry.body).toHaveLength(1);
    expect(pantry.body[0].quantity).toBe(0);
    expect(pantry.body[0].lowStockThreshold).toBe(1);
  });
});
