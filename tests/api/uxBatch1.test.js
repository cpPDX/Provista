const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const ShoppingTrip = require('../../models/ShoppingTrip');
const { createOwnerSession } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

describe('UX Batch 1 correctness contracts', () => {
  it('returns durable lastPurchasedAt values without requiring Price History state', async () => {
    const { cookie, user } = await createOwnerSession(app);
    const createItem = async name => {
      const response = await request(app).post('/api/items').set('Cookie', cookie)
        .send({ name, category: 'Other', unit: 'each' });
      expect(response.status).toBe(201);
      return response.body;
    };
    const [manualItem, tripItem, neverItem] = await Promise.all([
      createItem('Manual Purchase Product'),
      createItem('Trip Purchase Product'),
      createItem('Never Purchased Product')
    ]);

    const storeResponse = await request(app).post('/api/stores').set('Cookie', cookie)
      .send({ name: 'Batch One Store' });
    expect(storeResponse.status).toBe(201);

    const priceResponse = await request(app).post('/api/prices').set('Cookie', cookie).send({
      itemId: manualItem._id,
      storeId: storeResponse.body._id,
      regularPrice: 3.5,
      quantity: 1,
      date: '2026-07-10T12:00:00.000Z'
    });
    expect(priceResponse.status).toBe(201);

    await ShoppingTrip.create({
      householdId: user.householdId,
      completedBy: user._id,
      completedAt: new Date('2026-08-12T18:00:00.000Z'),
      idempotencyKey: `ux-batch1-${Date.now()}`,
      status: 'completed',
      addToPantry: false,
      total: 0,
      itemCount: 1,
      pricedItemCount: 0,
      missingPriceCount: 1,
      pantryItemCount: 0,
      approvedPriceCount: 0,
      pendingPriceCount: 0,
      lowStockCount: 0,
      items: [{
        shoppingListItemId: new mongoose.Types.ObjectId(),
        itemId: tripItem._id,
        itemName: tripItem.name,
        category: tripItem.category,
        unit: tripItem.unit,
        quantity: 1,
        storeId: storeResponse.body._id,
        storeName: storeResponse.body.name,
        price: null
      }]
    });

    const catalogResponse = await request(app).get('/api/items').set('Cookie', cookie);
    expect(catalogResponse.status).toBe(200);
    const byName = Object.fromEntries(catalogResponse.body.map(item => [item.name, item]));
    expect(byName['Manual Purchase Product'].lastPurchasedAt).toBe('2026-07-10T12:00:00.000Z');
    expect(byName['Trip Purchase Product'].lastPurchasedAt).toBe('2026-08-12T18:00:00.000Z');
    expect(byName['Never Purchased Product'].lastPurchasedAt).toBeNull();
  });

  it('keeps store ids in monthly Spending breakdowns for exact drill-downs', async () => {
    const { cookie } = await createOwnerSession(app);
    const itemResponse = await request(app).post('/api/items').set('Cookie', cookie)
      .send({ name: 'Spend Store Product', category: 'Dairy', unit: 'each' });
    const storeResponse = await request(app).post('/api/stores').set('Cookie', cookie)
      .send({ name: 'Exact Store' });
    expect(itemResponse.status).toBe(201);
    expect(storeResponse.status).toBe(201);

    const priceResponse = await request(app).post('/api/prices').set('Cookie', cookie).send({
      itemId: itemResponse.body._id,
      storeId: storeResponse.body._id,
      regularPrice: 4.25,
      quantity: 1,
      date: '2026-08-15T12:00:00.000Z'
    });
    expect(priceResponse.status).toBe(201);

    const spendResponse = await request(app).get('/api/spend?month=2026-08').set('Cookie', cookie);
    expect(spendResponse.status).toBe(200);
    expect(spendResponse.body.byStore).toEqual([
      expect.objectContaining({
        name: 'Exact Store',
        storeId: storeResponse.body._id,
        amount: 4.25
      })
    ]);
  });
});
