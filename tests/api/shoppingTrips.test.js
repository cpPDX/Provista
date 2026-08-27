const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function createDeferredTrip() {
  const { cookie } = await createOwnerSession(app);
  const item = await request(app).post('/api/items').set('Cookie', cookie)
    .send({ name: 'Deferred Milk', category: 'Dairy', unit: 'each' });
  const store = await request(app).post('/api/stores').set('Cookie', cookie)
    .send({ name: 'Neighborhood Market', location: 'Portland' });
  const listItem = await request(app).post('/api/shopping-list').set('Cookie', cookie)
    .send({ itemId: item.body._id, quantity: 1, storeId: store.body._id });
  await request(app).put(`/api/shopping-list/${listItem.body._id}`).set('Cookie', cookie)
    .send({ checked: true });

  const complete = await request(app).post('/api/shopping-list/complete').set('Cookie', cookie)
    .send({
      idempotencyKey: `deferred-${Date.now()}-${Math.random()}`,
      purchases: [{ listItemId: listItem.body._id, price: null, storeId: store.body._id }],
      addToPantry: true
    });
  expect(complete.status).toBe(201);
  expect(complete.body.missingPriceCount).toBe(1);
  return { cookie, item, store, listItem, tripId: complete.body.tripId };
}

describe('deferred shopping prices', () => {
  it('keeps Later items actionable and updates Spend when resolved', async () => {
    const fixture = await createDeferredTrip();

    const pending = await request(app).get('/api/shopping-trips/deferred-prices')
      .set('Cookie', fixture.cookie);
    expect(pending.status).toBe(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({
      tripId: fixture.tripId,
      shoppingListItemId: fixture.listItem.body._id,
      itemName: 'Deferred Milk',
      storeName: 'Neighborhood Market'
    });

    const resolved = await request(app)
      .patch(`/api/shopping-trips/${fixture.tripId}/items/${fixture.listItem.body._id}/price`)
      .set('Cookie', fixture.cookie)
      .send({ price: 4.79 });
    expect(resolved.status).toBe(200);
    expect(resolved.body.price).toBe(4.79);
    expect(resolved.body.trip.missingPriceCount).toBe(0);
    expect(resolved.body.trip.total).toBe(4.79);

    const after = await request(app).get('/api/shopping-trips/deferred-prices')
      .set('Cookie', fixture.cookie);
    expect(after.body).toHaveLength(0);

    const month = new Date().toISOString().slice(0, 7);
    const spend = await request(app).get(`/api/spend?month=${month}`).set('Cookie', fixture.cookie);
    expect(spend.status).toBe(200);
    expect(spend.body.total).toBe(4.79);
    expect(spend.body.byStore).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Neighborhood Market', amount: 4.79 })
    ]));
  });

  it('cannot resolve the same deferred price twice', async () => {
    const fixture = await createDeferredTrip();
    const url = `/api/shopping-trips/${fixture.tripId}/items/${fixture.listItem.body._id}/price`;

    const first = await request(app).patch(url).set('Cookie', fixture.cookie).send({ price: 3.5 });
    expect(first.status).toBe(200);
    const second = await request(app).patch(url).set('Cookie', fixture.cookie).send({ price: 9.99 });
    expect(second.status).toBe(409);

    const month = new Date().toISOString().slice(0, 7);
    const spend = await request(app).get(`/api/spend?month=${month}`).set('Cookie', fixture.cookie);
    expect(spend.body.total).toBe(3.5);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/shopping-trips/deferred-prices');
    expect(res.status).toBe(401);
  });
});
