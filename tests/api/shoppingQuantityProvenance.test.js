const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession } = require('../helpers/auth');
const InventoryItem = require('../../models/InventoryItem');
const PriceEntry = require('../../models/PriceEntry');
const ShoppingTrip = require('../../models/ShoppingTrip');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function createCatalogItem(cookie, name = 'Black Beans') {
  const response = await request(app).post('/api/items').set('Cookie', cookie)
    .send({ name, category: 'Pantry', unit: 'can' });
  expect(response.status).toBe(201);
  return response.body;
}

async function createStore(cookie, name) {
  const response = await request(app).post('/api/stores').set('Cookie', cookie).send({ name });
  expect(response.status).toBe(201);
  return response.body;
}

async function addGeneratedNeed(cookie, itemId, quantity) {
  const response = await request(app).post('/api/shopping-list/from-meal').set('Cookie', cookie)
    .send({ items: [{ itemId, quantity }] });
  expect(response.status).toBe(201);
  const list = await request(app).get('/api/shopping-list').set('Cookie', cookie);
  expect(list.status).toBe(200);
  return list.body.find(entry => String(entry.itemId?._id || entry.itemId) === String(itemId));
}

describe('shopping quantity provenance', () => {
  it('preserves required, intended, and actual quantities through checkout', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createCatalogItem(cookie);
    const currentStore = await createStore(cookie, 'Current Market');
    const futurePreferredStore = await createStore(cookie, 'Future Market');
    const generated = await addGeneratedNeed(cookie, item._id, 1);

    expect(generated).toMatchObject({
      quantity: 1,
      intendedPurchaseQuantity: 1,
      requiredQuantity: 1,
      quantitySource: 'system',
      remainingRequiredQuantity: 0
    });

    const intended = await request(app).put(`/api/shopping-list/${generated._id}`).set('Cookie', cookie)
      .send({ intendedPurchaseQuantity: 5 });
    expect(intended.status).toBe(200);
    expect(intended.body).toMatchObject({
      quantity: 5,
      requiredQuantity: 1,
      quantitySource: 'user'
    });

    const checked = await request(app).put(`/api/shopping-list/${generated._id}`).set('Cookie', cookie)
      .send({ checked: true, shoppingStoreId: currentStore._id, actualPurchasedQuantity: 4 });
    expect(checked.status).toBe(200);
    expect(checked.body.actualPurchasedQuantity).toBe(4);
    expect(String(checked.body.shoppingStoreId._id || checked.body.shoppingStoreId)).toBe(currentStore._id);

    const preferenceChange = await request(app).put(`/api/shopping-list/${generated._id}`).set('Cookie', cookie)
      .send({ storeId: futurePreferredStore._id });
    expect(preferenceChange.status).toBe(200);
    expect(String(preferenceChange.body.storeId._id || preferenceChange.body.storeId)).toBe(futurePreferredStore._id);
    expect(String(preferenceChange.body.shoppingStoreId._id || preferenceChange.body.shoppingStoreId)).toBe(currentStore._id);

    const complete = await request(app).post('/api/shopping-list/complete').set('Cookie', cookie)
      .send({
        idempotencyKey: `quantity-provenance-${Date.now()}`,
        purchases: [{ listItemId: generated._id, price: 8, storeId: currentStore._id }],
        addToPantry: true
      });
    expect(complete.status).toBe(201);

    const pantry = await InventoryItem.findOne({ itemId: item._id }).lean();
    expect(pantry.quantity).toBe(4);

    const price = await PriceEntry.findOne({ itemId: item._id, source: 'shopping-trip' }).lean();
    expect(price.quantity).toBe(4);
    expect(price.pricePerUnit).toBe(2);

    const trip = await ShoppingTrip.findById(complete.body.tripId).lean();
    expect(trip.items[0]).toMatchObject({
      quantity: 4,
      requiredQuantity: 1,
      intendedPurchaseQuantity: 5,
      actualPurchasedQuantity: 4,
      quantitySource: 'user',
      storeName: 'Current Market'
    });
  });

  it('keeps uncovered demand visible when the parent plans to buy less', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createCatalogItem(cookie, 'Tomato Soup');
    const generated = await addGeneratedNeed(cookie, item._id, 3);

    const update = await request(app).put(`/api/shopping-list/${generated._id}`).set('Cookie', cookie)
      .send({ intendedPurchaseQuantity: 1 });
    expect(update.status).toBe(200);

    const list = await request(app).get('/api/shopping-list').set('Cookie', cookie);
    const row = list.body.find(entry => entry._id === generated._id);
    expect(row).toMatchObject({
      quantity: 1,
      intendedPurchaseQuantity: 1,
      requiredQuantity: 3,
      remainingRequiredQuantity: 2,
      quantitySource: 'user'
    });
  });

  it('never overwrites a user quantity override when required demand changes', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createCatalogItem(cookie, 'Backup Pasta');
    const generated = await addGeneratedNeed(cookie, item._id, 4);

    const override = await request(app).put(`/api/shopping-list/${generated._id}`).set('Cookie', cookie)
      .send({ intendedPurchaseQuantity: 6 });
    expect(override.status).toBe(200);

    const recalc = await request(app).put(`/api/shopping-list/${generated._id}`).set('Cookie', cookie)
      .send({ requiredQuantity: 2 });
    expect(recalc.status).toBe(200);
    expect(recalc.body).toMatchObject({
      quantity: 6,
      requiredQuantity: 2,
      quantitySource: 'user'
    });
  });

  it('attaches later Plan demand to a manual List item without replacing the parent quantity', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createCatalogItem(cookie, 'Manual First Rice');
    const manual = await request(app).post('/api/shopping-list').set('Cookie', cookie)
      .send({ itemId: item._id, quantity: 6 });
    expect(manual.status).toBe(201);
    expect(manual.body.quantitySource).toBe('user');

    const planNeed = await request(app).post('/api/shopping-list/from-meal').set('Cookie', cookie)
      .send({ items: [{ itemId: item._id, quantity: 3 }] });
    expect(planNeed.status).toBe(200);
    expect(planNeed.body).toMatchObject({
      addedCount: 0,
      skippedCount: 1,
      requirementUpdatedCount: 1
    });

    const list = await request(app).get('/api/shopping-list').set('Cookie', cookie);
    const row = list.body.find(entry => entry._id === manual.body._id);
    expect(row).toMatchObject({
      quantity: 6,
      intendedPurchaseQuantity: 6,
      requiredQuantity: 3,
      quantitySource: 'user'
    });
  });
});
