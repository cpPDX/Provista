const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function createHouseholdFixtures(prefix) {
  const { cookie } = await createOwnerSession(app, { email: `${prefix}@test.com` });
  const item = await request(app).post('/api/items').set('Cookie', cookie)
    .send({ name: `${prefix} Milk`, category: 'Dairy', unit: 'gal' });
  const store = await request(app).post('/api/stores').set('Cookie', cookie)
    .send({ name: `${prefix} Market` });
  return { cookie, itemId: item.body._id, storeId: store.body._id };
}

describe('shopping-list household scoping', () => {
  it('rejects an item owned by another household', async () => {
    const a = await createHouseholdFixtures('scope-a');
    const b = await createHouseholdFixtures('scope-b');

    const res = await request(app).post('/api/shopping-list').set('Cookie', a.cookie)
      .send({ itemId: b.itemId, quantity: 1 });

    expect(res.status).toBe(404);
    const list = await request(app).get('/api/shopping-list').set('Cookie', a.cookie);
    expect(list.body).toHaveLength(0);
  });

  it('rejects a preferred store owned by another household', async () => {
    const a = await createHouseholdFixtures('scope-a');
    const b = await createHouseholdFixtures('scope-b');

    const res = await request(app).post('/api/shopping-list').set('Cookie', a.cookie)
      .send({ itemId: a.itemId, storeId: b.storeId, quantity: 1 });

    expect(res.status).toBe(404);
  });

  it('does not let an update switch a list item to another household store', async () => {
    const a = await createHouseholdFixtures('scope-a');
    const b = await createHouseholdFixtures('scope-b');
    const added = await request(app).post('/api/shopping-list').set('Cookie', a.cookie)
      .send({ itemId: a.itemId, storeId: a.storeId, quantity: 1 });

    const res = await request(app).put(`/api/shopping-list/${added.body._id}`).set('Cookie', a.cookie)
      .send({ storeId: b.storeId });
    expect(res.status).toBe(404);

    const list = await request(app).get('/api/shopping-list').set('Cookie', a.cookie);
    expect(String(list.body[0].storeId._id)).toBe(String(a.storeId));
  });

  it('ignores arbitrary relationship fields instead of allowing reassignment', async () => {
    const a = await createHouseholdFixtures('scope-a');
    const b = await createHouseholdFixtures('scope-b');
    const added = await request(app).post('/api/shopping-list').set('Cookie', a.cookie)
      .send({ itemId: a.itemId, quantity: 1 });

    const res = await request(app).put(`/api/shopping-list/${added.body._id}`).set('Cookie', a.cookie)
      .send({ itemId: b.itemId, householdId: '64f0000000000000000000aa' });
    expect(res.status).toBe(400);

    const list = await request(app).get('/api/shopping-list').set('Cookie', a.cookie);
    expect(String(list.body[0].itemId._id)).toBe(String(a.itemId));
  });
});

describe('shopping-list expected price context', () => {
  it('uses the assigned store price for checkout while preserving the cheapest store recommendation', async () => {
    const a = await createHouseholdFixtures('price-context');
    const secondStore = await request(app).post('/api/stores').set('Cookie', a.cookie)
      .send({ name: 'Cheaper Market' });

    await request(app).post('/api/prices').set('Cookie', a.cookie)
      .send({ itemId: a.itemId, storeId: a.storeId, regularPrice: 6, quantity: 1 });
    await request(app).post('/api/prices').set('Cookie', a.cookie)
      .send({ itemId: a.itemId, storeId: secondStore.body._id, regularPrice: 4, quantity: 1 });
    await request(app).post('/api/shopping-list').set('Cookie', a.cookie)
      .send({ itemId: a.itemId, storeId: a.storeId, quantity: 2 });

    const list = await request(app).get('/api/shopping-list').set('Cookie', a.cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(String(list.body[0].bestPrice.store._id)).toBe(String(secondStore.body._id));
    expect(String(list.body[0].expectedPrice.store._id)).toBe(String(a.storeId));
    expect(list.body[0].expectedPrice.pricePerUnit).toBe(6);
  });
});
