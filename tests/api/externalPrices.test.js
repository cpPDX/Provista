const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession } = require('../helpers/auth');
const Item = require('../../models/Item');
const Store = require('../../models/Store');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('Open Prices shopping list refresh', () => {
  it('stores a location-specific observation and reuses the cache', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await request(app).post('/api/items').set('Cookie', cookie)
      .send({ name: 'UPC Yogurt', category: 'Dairy', unit: 'each' });
    const store = await request(app).post('/api/stores').set('Cookie', cookie)
      .send({ name: 'Example Market', location: 'Portland' });

    await Item.updateOne({ _id: item.body._id }, { $set: { upc: '012345678905' } });
    await Store.updateOne({ _id: store.body._id }, { $set: { 'externalIds.open-prices': '42' } });
    await request(app).patch('/api/household/settings').set('Cookie', cookie)
      .send({ usualStoreId: store.body._id });
    await request(app).post('/api/shopping-list').set('Cookie', cookie)
      .send({ itemId: item.body._id, quantity: 1 });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: 9001,
          product_id: 77,
          product_code: '012345678905',
          location_id: 42,
          price: 2.49,
          price_is_discounted: false,
          price_without_discount: null,
          currency: 'USD',
          date: new Date().toISOString().slice(0, 10)
        }]
      })
    });

    const first = await request(app).post('/api/external-prices/refresh-shopping-list')
      .set('Cookie', cookie).send({});
    expect(first.status).toBe(200);
    expect(first.body.provider).toBe('open-prices');
    expect(first.body.observationCount).toBe(1);
    expect(first.body.observations[0]).toMatchObject({
      itemId: item.body._id,
      storeId: store.body._id,
      storeName: 'Example Market',
      cached: false,
      observation: expect.objectContaining({ provider: 'open-prices', price: 2.49, confidence: 1 })
    });

    const requestedUrl = String(global.fetch.mock.calls[0][0]);
    expect(requestedUrl).toContain('product_code=012345678905');
    expect(requestedUrl).toContain('location_id=42');

    const second = await request(app).post('/api/external-prices/refresh-shopping-list')
      .set('Cookie', cookie).send({});
    expect(second.status).toBe(200);
    expect(second.body.observations[0].cached).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not fail the shopping workflow when Open Prices is unavailable', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await request(app).post('/api/items').set('Cookie', cookie)
      .send({ name: 'Unavailable Price Item', category: 'Other', unit: 'each' });
    const store = await request(app).post('/api/stores').set('Cookie', cookie)
      .send({ name: 'Unavailable Market', location: 'Portland' });

    await Item.updateOne({ _id: item.body._id }, { $set: { upc: '098765432109' } });
    await Store.updateOne({ _id: store.body._id }, { $set: { 'externalIds.open-prices': '88' } });
    await request(app).patch('/api/household/settings').set('Cookie', cookie)
      .send({ usualStoreId: store.body._id });
    await request(app).post('/api/shopping-list').set('Cookie', cookie)
      .send({ itemId: item.body._id, quantity: 1 });

    global.fetch = jest.fn().mockRejectedValue(new Error('network unavailable'));
    const refresh = await request(app).post('/api/external-prices/refresh-shopping-list')
      .set('Cookie', cookie).send({});
    expect(refresh.status).toBe(200);
    expect(refresh.body.observationCount).toBe(0);
    expect(refresh.body.failedCount).toBe(1);

    const list = await request(app).get('/api/shopping-list').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });
});
