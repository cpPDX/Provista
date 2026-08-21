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
  const storeRes = await request(app).post('/api/stores').set('Cookie', ownerCookie)
    .send({ name: 'Test Market', location: 'Main St' });
  return { ownerCookie, itemId: itemRes.body._id, storeId: storeRes.body._id };
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

describe('POST /api/shopping-list/complete-trip', () => {
  it('records purchases, updates Pantry and Spend, and clears checked items', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures();
    const added = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, storeId, quantity: 2 });
    await request(app).put(`/api/shopping-list/${added.body._id}`).set('Cookie', ownerCookie)
      .send({ checked: true });

    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app).post('/api/shopping-list/complete-trip').set('Cookie', ownerCookie)
      .send({
        date: today,
        updatePantry: true,
        items: [{ listItemId: added.body._id, storeId, price: 5.5, priceSource: 'manual' }]
      });

    expect(res.status).toBe(200);
    expect(res.body.purchasedCount).toBe(1);
    expect(res.body.pricesRecorded).toBe(1);
    expect(res.body.pantryUpdatedCount).toBe(1);
    expect(res.body.tripTotal).toBe(5.5);

    const list = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(list.body).toHaveLength(0);

    const pantry = await request(app).get('/api/inventory').set('Cookie', ownerCookie);
    expect(pantry.status).toBe(200);
    expect(pantry.body).toHaveLength(1);
    expect(pantry.body[0].quantity).toBe(2);

    const month = today.slice(0, 7);
    const spend = await request(app).get(`/api/spend?month=${month}`).set('Cookie', ownerCookie);
    expect(spend.status).toBe(200);
    expect(spend.body.total).toBe(5.5);
  });

  it('lets a household member finish a real purchase and see Pantry updates', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures();
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const added = await request(app).post('/api/shopping-list').set('Cookie', memberCookie)
      .send({ itemId, storeId, quantity: 1 });
    await request(app).put(`/api/shopping-list/${added.body._id}`).set('Cookie', memberCookie)
      .send({ checked: true });

    const res = await request(app).post('/api/shopping-list/complete-trip').set('Cookie', memberCookie)
      .send({ items: [{ listItemId: added.body._id, storeId, price: 3.25, priceSource: 'expected' }] });
    expect(res.status).toBe(200);
    expect(res.body.pricesRecorded).toBe(1);

    const pantry = await request(app).get('/api/inventory').set('Cookie', memberCookie);
    expect(pantry.status).toBe(200);
    expect(pantry.body[0].quantity).toBe(1);
  });

  it('does not add to Pantry when the user opts out', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures();
    const added = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, storeId, quantity: 1 });
    await request(app).put(`/api/shopping-list/${added.body._id}`).set('Cookie', ownerCookie)
      .send({ checked: true });

    const res = await request(app).post('/api/shopping-list/complete-trip').set('Cookie', ownerCookie)
      .send({ updatePantry: false, items: [{ listItemId: added.body._id, storeId, price: 2.99 }] });
    expect(res.status).toBe(200);
    expect(res.body.pantryUpdatedCount).toBe(0);

    const pantry = await request(app).get('/api/inventory').set('Cookie', ownerCookie);
    expect(pantry.body).toHaveLength(0);
  });

  it('rejects stores from another household without clearing the list', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const added = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 1 });
    await request(app).put(`/api/shopping-list/${added.body._id}`).set('Cookie', ownerCookie)
      .send({ checked: true });

    const { cookie: otherCookie } = await createOwnerSession(app, { email: 'other-household@test.com' });
    const foreignStore = await request(app).post('/api/stores').set('Cookie', otherCookie)
      .send({ name: 'Foreign Store' });

    const res = await request(app).post('/api/shopping-list/complete-trip').set('Cookie', ownerCookie)
      .send({ items: [{ listItemId: added.body._id, storeId: foreignStore.body._id, price: 4.25 }] });
    expect(res.status).toBe(400);

    const list = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].checked).toBe(true);
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