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

  it('rejects an item from another household', async () => {
    const first = await setupFixtures();
    const { cookie: otherCookie } = await createOwnerSession(app);
    const foreignItem = await request(app).post('/api/items').set('Cookie', otherCookie)
      .send({ name: 'Foreign List Item', category: 'Other', unit: 'each' });
    const res = await request(app).post('/api/shopping-list').set('Cookie', first.ownerCookie)
      .send({ itemId: foreignItem.body._id, quantity: 1 });
    expect(res.status).toBe(404);
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

  it('marks stale prices and keeps the usual store as the practical default', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const usual = await request(app).post('/api/stores').set('Cookie', ownerCookie)
      .send({ name: 'Usual Market' });
    const staleCheap = await request(app).post('/api/stores').set('Cookie', ownerCookie)
      .send({ name: 'Old Bargain' });
    await request(app).patch('/api/household/settings').set('Cookie', ownerCookie)
      .send({ usualStoreId: usual.body._id, priceFreshnessDays: 30, additionalStopSavingsThreshold: 5 });
    await request(app).post('/api/prices').set('Cookie', ownerCookie).send({
      itemId, storeId: usual.body._id, regularPrice: 6, quantity: 1, date: new Date().toISOString()
    });
    await request(app).post('/api/prices').set('Cookie', ownerCookie).send({
      itemId,
      storeId: staleCheap.body._id,
      regularPrice: 1,
      quantity: 1,
      date: new Date(Date.now() - 60 * 86400000).toISOString()
    });
    await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 1 });

    const res = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body[0].tripStore._id).toBe(usual.body._id);
    expect(res.body[0].bestPrice.store._id).toBe(usual.body._id);
    const oldPrice = res.body[0].priceOptions.find(price => price.store._id === staleCheap.body._id);
    expect(oldPrice.isStale).toBe(true);
    expect(oldPrice.ageDays).toBeGreaterThanOrEqual(59);
  });

  it('suggests another store only when total estimated savings clear the configured threshold', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const usual = await request(app).post('/api/stores').set('Cookie', ownerCookie)
      .send({ name: 'Normal Store' });
    const alternate = await request(app).post('/api/stores').set('Cookie', ownerCookie)
      .send({ name: 'Alternate Store' });
    await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send({ itemId, storeId: usual.body._id, regularPrice: 10, quantity: 1 });
    await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send({ itemId, storeId: alternate.body._id, regularPrice: 7, quantity: 1 });
    await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 1 });

    await request(app).patch('/api/household/settings').set('Cookie', ownerCookie)
      .send({ usualStoreId: usual.body._id, additionalStopSavingsThreshold: 5 });
    const below = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(below.body[0].tripStore._id).toBe(usual.body._id);
    expect(below.body[0].priceContext.additionalStore).toBeNull();

    await request(app).patch('/api/household/settings').set('Cookie', ownerCookie)
      .send({ additionalStopSavingsThreshold: 2 });
    const above = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(above.body[0].tripStore._id).toBe(alternate.body._id);
    expect(above.body[0].priceContext.estimatedAdditionalStopSavings).toBe(3);
  });
});

describe('POST /api/shopping-list/from-meal', () => {
  it('adds reviewed meal items in one batch and skips List duplicates', async () => {
    const { ownerCookie, itemId: breadId } = await setupFixtures();
    const salsa = await request(app).post('/api/items').set('Cookie', ownerCookie)
      .send({ name: 'Meal Batch Salsa', category: 'Other', unit: 'jar' });
    expect(salsa.status).toBe(201);
    const listSetup = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId: breadId, quantity: 1 });
    expect(listSetup.status).toBe(201);

    const res = await request(app).post('/api/shopping-list/from-meal').set('Cookie', ownerCookie)
      .send({
        items: [
          { itemId: breadId, quantity: 4 },
          { itemId: salsa.body._id, quantity: 2 },
          { itemId: salsa.body._id, quantity: 1 }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ addedCount: 1, skippedCount: 1 });
    const list = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(list.body).toHaveLength(2);
    expect(list.body.find(item => item.itemId._id === breadId).quantity).toBe(1);
    expect(list.body.find(item => item.itemId._id === salsa.body._id).quantity).toBe(2);
  });

  it('allows a household member to add reviewed meal items', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).post('/api/shopping-list/from-meal').set('Cookie', memberCookie)
      .send({ items: [{ itemId, quantity: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.addedCount).toBe(1);
  });

  it('rejects an item from another household', async () => {
    const first = await setupFixtures();
    const { cookie: otherCookie } = await createOwnerSession(app);
    const foreignItem = await request(app).post('/api/items').set('Cookie', otherCookie)
      .send({ name: 'Foreign Meal Item', category: 'Other', unit: 'each' });

    const res = await request(app).post('/api/shopping-list/from-meal').set('Cookie', first.ownerCookie)
      .send({ items: [{ itemId: foreignItem.body._id, quantity: 1 }] });
    expect(res.status).toBe(404);
    const list = await request(app).get('/api/shopping-list').set('Cookie', first.ownerCookie);
    expect(list.body).toHaveLength(0);
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

describe('POST /api/shopping-list/complete', () => {
  async function createCheckedPurchase(ownerCookie, itemId, quantity = 1) {
    const store = await request(app).post('/api/stores').set('Cookie', ownerCookie)
      .send({ name: `Trip Store ${Date.now()}-${Math.random()}` });
    const added = await request(app).post('/api/shopping-list').set('Cookie', ownerCookie)
      .send({ itemId, quantity, storeId: store.body._id });
    await request(app).put(`/api/shopping-list/${added.body._id}`).set('Cookie', ownerCookie)
      .send({ checked: true });
    return { storeId: store.body._id, listItemId: added.body._id };
  }

  it('closes the loop across Pantry, price history, Spend, list, and low stock', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    await request(app).post('/api/inventory').set('Cookie', ownerCookie)
      .send({ itemId, quantity: 0, lowStockThreshold: 1 });
    const purchase = await createCheckedPurchase(ownerCookie, itemId, 2);

    const res = await request(app).post('/api/shopping-list/complete').set('Cookie', ownerCookie)
      .send({
        idempotencyKey: `owner-trip-${Date.now()}`,
        addToPantry: true,
        purchases: [{ ...purchase, price: 8.5 }]
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      total: 8.5,
      itemCount: 1,
      missingPriceCount: 0,
      pantryUpdated: true,
      pantryItemCount: 1,
      approvedPriceCount: 1,
      pendingPriceCount: 0,
      lowStockCount: 0
    });

    const [list, pantry, prices, spend] = await Promise.all([
      request(app).get('/api/shopping-list').set('Cookie', ownerCookie),
      request(app).get('/api/inventory').set('Cookie', ownerCookie),
      request(app).get(`/api/prices/history/${itemId}`).set('Cookie', ownerCookie),
      request(app).get(`/api/spend?month=${new Date().toISOString().slice(0, 7)}`).set('Cookie', ownerCookie)
    ]);
    expect(list.body).toHaveLength(0);
    expect(pantry.body).toHaveLength(1);
    expect(pantry.body[0].quantity).toBe(2);
    expect(prices.body).toHaveLength(1);
    expect(prices.body[0]).toMatchObject({ source: 'shopping-trip', finalPrice: 8.5, quantity: 2, status: 'approved' });
    expect(spend.body.total).toBe(8.5);
  });

  it('is idempotent when the client retries the same completion', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const purchase = await createCheckedPurchase(ownerCookie, itemId);
    const body = {
      idempotencyKey: `retry-trip-${Date.now()}`,
      addToPantry: true,
      purchases: [{ ...purchase, price: 3.25 }]
    };

    const first = await request(app).post('/api/shopping-list/complete').set('Cookie', ownerCookie).send(body);
    const retry = await request(app).post('/api/shopping-list/complete').set('Cookie', ownerCookie).send(body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.idempotent).toBe(true);
    expect(retry.body.tripId).toBe(first.body.tripId);

    const [pantry, prices, spend] = await Promise.all([
      request(app).get('/api/inventory').set('Cookie', ownerCookie),
      request(app).get(`/api/prices/history/${itemId}`).set('Cookie', ownerCookie),
      request(app).get(`/api/spend?month=${new Date().toISOString().slice(0, 7)}`).set('Cookie', ownerCookie)
    ]);
    expect(pantry.body[0].quantity).toBe(1);
    expect(prices.body).toHaveLength(1);
    expect(spend.body.total).toBe(3.25);
  });

  it('trusts a member shopping-trip price by default while updating Spend and Pantry', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const purchase = await createCheckedPurchase(ownerCookie, itemId);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const res = await request(app).post('/api/shopping-list/complete').set('Cookie', memberCookie)
      .send({
        idempotencyKey: `member-trip-${Date.now()}`,
        addToPantry: true,
        purchases: [{ ...purchase, price: 4.75 }]
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ pendingPriceCount: 0, approvedPriceCount: 1, total: 4.75 });
    const [pantry, prices, spend] = await Promise.all([
      request(app).get('/api/inventory').set('Cookie', memberCookie),
      request(app).get(`/api/prices/history/${itemId}`).set('Cookie', memberCookie),
      request(app).get(`/api/spend?month=${new Date().toISOString().slice(0, 7)}`).set('Cookie', memberCookie)
    ]);
    expect(pantry.body[0].quantity).toBe(1);
    expect(prices.body[0].status).toBe('approved');
    expect(spend.body.total).toBe(4.75);
  });

  it('leaves member shopping-trip prices pending only when strict review is enabled', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const purchase = await createCheckedPurchase(ownerCookie, itemId);
    const settings = await request(app).patch('/api/household/settings').set('Cookie', ownerCookie)
      .send({ strictPriceReview: true });
    expect(settings.status).toBe(200);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const res = await request(app).post('/api/shopping-list/complete').set('Cookie', memberCookie)
      .send({
        idempotencyKey: `strict-member-trip-${Date.now()}`,
        addToPantry: true,
        purchases: [{ ...purchase, price: 5.25 }]
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ pendingPriceCount: 1, approvedPriceCount: 0 });
    const prices = await request(app).get(`/api/prices/history/${itemId}`).set('Cookie', memberCookie);
    expect(prices.body[0].status).toBe('pending');
  });

  it('can finish with missing prices without changing Pantry', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const purchase = await createCheckedPurchase(ownerCookie, itemId);

    const res = await request(app).post('/api/shopping-list/complete').set('Cookie', ownerCookie)
      .send({
        idempotencyKey: `no-pantry-trip-${Date.now()}`,
        addToPantry: false,
        purchases: [{ listItemId: purchase.listItemId, price: null, storeId: null }]
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ total: 0, missingPriceCount: 1, pantryUpdated: false, pantryItemCount: 0 });
    const [pantry, prices] = await Promise.all([
      request(app).get('/api/inventory').set('Cookie', ownerCookie),
      request(app).get(`/api/prices/history/${itemId}`).set('Cookie', ownerCookie)
    ]);
    expect(pantry.body).toHaveLength(0);
    expect(prices.body).toHaveLength(0);
  });

  it('rejects a store from another household without changing the list', async () => {
    const { ownerCookie, itemId } = await setupFixtures();
    const purchase = await createCheckedPurchase(ownerCookie, itemId);
    const { cookie: otherCookie } = await createOwnerSession(app);
    const otherStore = await request(app).post('/api/stores').set('Cookie', otherCookie)
      .send({ name: 'Other Household Store' });

    const res = await request(app).post('/api/shopping-list/complete').set('Cookie', ownerCookie)
      .send({
        idempotencyKey: `cross-household-trip-${Date.now()}`,
        purchases: [{ listItemId: purchase.listItemId, price: 2.5, storeId: otherStore.body._id }]
      });
    expect(res.status).toBe(404);

    const list = await request(app).get('/api/shopping-list').set('Cookie', ownerCookie);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].checked).toBe(true);
  });
});
