const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');
const PriceEntry = require('../../models/PriceEntry');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

describe('POST /api/grocery/log', () => {
  it('creates a new item and its first price in one request', async () => {
    const { cookie } = await createOwnerSession(app);
    const store = await request(app)
      .post('/api/stores')
      .set('Cookie', cookie)
      .send({ name: 'Costco' });

    const res = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', cookie)
      .send({
        item: {
          name: 'Whole Milk',
          category: 'Dairy',
          unit: 'gal',
          brand: 'Kirkland'
        },
        storeId: store.body._id,
        regularPrice: 4.79,
        quantity: 1,
        notes: 'First entry'
      });

    expect(res.status).toBe(201);
    expect(res.body.createdItem).toBeTruthy();
    expect(res.body.createdItem.name).toBe('Whole Milk');
    expect(res.body.entry.itemId.name).toBe('Whole Milk');
    expect(res.body.entry.storeId.name).toBe('Costco');
    expect(res.body.entry.finalPrice).toBe(4.79);
    expect(res.body.entry.status).toBe('approved');

    const items = await request(app).get('/api/items?search=Whole').set('Cookie', cookie);
    expect(items.body.some(item => item.name === 'Whole Milk')).toBe(true);
  });

  it('logs a price for an existing item', async () => {
    const { cookie } = await createOwnerSession(app);
    const [item, store] = await Promise.all([
      request(app).post('/api/items').set('Cookie', cookie)
        .send({ name: 'Eggs', category: 'Dairy', unit: 'dozen' }),
      request(app).post('/api/stores').set('Cookie', cookie)
        .send({ name: 'Fred Meyer' })
    ]);

    const res = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', cookie)
      .send({ itemId: item.body._id, storeId: store.body._id, regularPrice: 3.99, quantity: 1 });

    expect(res.status).toBe(201);
    expect(res.body.createdItem).toBeNull();
    expect(res.body.entry.itemId.name).toBe('Eggs');
    expect(res.body.entry.finalPrice).toBe(3.99);
  });

  it('can create a store as part of the same log action', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await request(app).post('/api/items').set('Cookie', cookie)
      .send({ name: 'Bananas', category: 'Produce', unit: 'lb' });

    const res = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', cookie)
      .send({
        itemId: item.body._id,
        store: { name: 'Neighborhood Market', location: 'Main St' },
        regularPrice: 0.69,
        quantity: 1
      });

    expect(res.status).toBe(201);
    expect(res.body.createdStore).toBeTruthy();
    expect(res.body.entry.storeId.name).toBe('Neighborhood Market');
  });

  it('allows a member to submit a price for existing household data as pending', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const [item, store] = await Promise.all([
      request(app).post('/api/items').set('Cookie', ownerCookie)
        .send({ name: 'Bread', category: 'Bakery', unit: 'loaf' }),
      request(app).post('/api/stores').set('Cookie', ownerCookie)
        .send({ name: 'Safeway' })
    ]);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const res = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', memberCookie)
      .send({ itemId: item.body._id, storeId: store.body._id, regularPrice: 4.25, quantity: 1 });

    expect(res.status).toBe(201);
    expect(res.body.entry.status).toBe('pending');
  });

  it('allows a member to create a store while submitting a pending price', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const item = await request(app).post('/api/items').set('Cookie', ownerCookie)
      .send({ name: 'Apples', category: 'Produce', unit: 'lb' });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const res = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', memberCookie)
      .send({
        itemId: item.body._id,
        store: { name: 'Corner Market' },
        regularPrice: 1.49,
        quantity: 2
      });

    expect(res.status).toBe(201);
    expect(res.body.createdStore.name).toBe('Corner Market');
    expect(res.body.entry.storeId.name).toBe('Corner Market');
    expect(res.body.entry.status).toBe('pending');
  });

  it('does not allow a member to create a catalog item through logging', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const store = await request(app).post('/api/stores').set('Cookie', ownerCookie)
      .send({ name: 'Safeway' });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const res = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', memberCookie)
      .send({
        item: { name: 'New Thing', category: 'Pantry', unit: 'each' },
        storeId: store.body._id,
        regularPrice: 2.5
      });

    expect(res.status).toBe(403);
  });

  it('can mark an entry as CSV-sourced', async () => {
    const { cookie } = await createOwnerSession(app);
    const [item, store] = await Promise.all([
      request(app).post('/api/items').set('Cookie', cookie)
        .send({ name: 'Pasta', category: 'Pantry', unit: 'box' }),
      request(app).post('/api/stores').set('Cookie', cookie)
        .send({ name: 'Market' })
    ]);

    const res = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', cookie)
      .send({
        itemId: item.body._id,
        storeId: store.body._id,
        regularPrice: 2.99,
        source: 'csv'
      });

    expect(res.status).toBe(201);
    expect(res.body.entry.source).toBe('csv');
  });

  it('replaces an existing household price only after the new entry is created', async () => {
    const { cookie } = await createOwnerSession(app);
    const [item, store] = await Promise.all([
      request(app).post('/api/items').set('Cookie', cookie)
        .send({ name: 'Coffee', category: 'Pantry', unit: 'bag' }),
      request(app).post('/api/stores').set('Cookie', cookie)
        .send({ name: 'Costco' })
    ]);

    const first = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', cookie)
      .send({ itemId: item.body._id, storeId: store.body._id, regularPrice: 12.99 });

    const replacement = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', cookie)
      .send({
        itemId: item.body._id,
        storeId: store.body._id,
        regularPrice: 10.99,
        source: 'csv',
        replacePriceEntryId: first.body.entry._id
      });

    expect(replacement.status).toBe(201);
    expect(replacement.body.replacedPriceEntryId).toBe(first.body.entry._id);
    expect(replacement.body.entry.finalPrice).toBe(10.99);

    const prices = await request(app).get('/api/prices').set('Cookie', cookie);
    expect(prices.body).toHaveLength(1);
    expect(prices.body[0]._id).toBe(replacement.body.entry._id);
  });

  it('replaces a same-day CSV price even when the old entry is outside the newest 100 prices', async () => {
    const { cookie, user } = await createOwnerSession(app);
    const [item, store] = await Promise.all([
      request(app).post('/api/items').set('Cookie', cookie)
        .send({ name: 'Deep History Coffee', category: 'Pantry', unit: 'bag' }),
      request(app).post('/api/stores').set('Cookie', cookie)
        .send({ name: 'History Store' })
    ]);

    const common = {
      householdId: user.householdId,
      itemId: item.body._id,
      storeId: store.body._id,
      submittedBy: user._id,
      regularPrice: 5,
      finalPrice: 5,
      quantity: 1,
      pricePerUnit: 5,
      source: 'csv',
      status: 'approved',
      reviewedBy: user._id,
      reviewedAt: new Date()
    };
    const docs = [{ ...common, date: new Date('2025-01-01T12:00:00.000Z') }];
    for (let i = 0; i < 100; i++) {
      docs.push({ ...common, date: new Date(Date.UTC(2025, 0, 2 + i)) });
    }
    await PriceEntry.insertMany(docs);

    const listed = await request(app).get('/api/prices').set('Cookie', cookie);
    expect(listed.body).toHaveLength(100);
    expect(listed.body.some(entry => String(entry.date).startsWith('2025-01-01'))).toBe(false);

    const replacement = await request(app).post('/api/grocery/log').set('Cookie', cookie)
      .send({
        itemId: item.body._id,
        storeId: store.body._id,
        regularPrice: 4.25,
        date: '2025-01-01T12:00:00.000Z',
        source: 'csv',
        replaceSameDay: true
      });
    expect(replacement.status).toBe(201);
    expect(replacement.body.replacedPriceEntryId).toBeTruthy();

    const sameDay = await PriceEntry.find({
      householdId: user.householdId,
      itemId: item.body._id,
      storeId: store.body._id,
      date: { $gte: new Date('2025-01-01T00:00:00.000Z'), $lt: new Date('2025-01-02T00:00:00.000Z') }
    });
    expect(sameDay).toHaveLength(1);
    expect(sameDay[0].finalPrice).toBe(4.25);
  });

  it('rejects replacement when item or store does not match and preserves the original', async () => {
    const { cookie } = await createOwnerSession(app);
    const [itemA, itemB, store] = await Promise.all([
      request(app).post('/api/items').set('Cookie', cookie)
        .send({ name: 'Coffee A', category: 'Pantry', unit: 'bag' }),
      request(app).post('/api/items').set('Cookie', cookie)
        .send({ name: 'Coffee B', category: 'Pantry', unit: 'bag' }),
      request(app).post('/api/stores').set('Cookie', cookie)
        .send({ name: 'Costco' })
    ]);

    const original = await request(app).post('/api/grocery/log').set('Cookie', cookie)
      .send({ itemId: itemA.body._id, storeId: store.body._id, regularPrice: 12.99 });

    const res = await request(app).post('/api/grocery/log').set('Cookie', cookie)
      .send({
        itemId: itemB.body._id,
        storeId: store.body._id,
        regularPrice: 10.99,
        replacePriceEntryId: original.body.entry._id
      });

    expect(res.status).toBe(400);

    const prices = await request(app).get('/api/prices').set('Cookie', cookie);
    expect(prices.body).toHaveLength(1);
    expect(prices.body[0]._id).toBe(original.body.entry._id);
    expect(prices.body[0].finalPrice).toBe(12.99);
  });

  it('does not allow a member to replace an existing price entry', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const [item, store] = await Promise.all([
      request(app).post('/api/items').set('Cookie', ownerCookie)
        .send({ name: 'Yogurt', category: 'Dairy', unit: 'each' }),
      request(app).post('/api/stores').set('Cookie', ownerCookie)
        .send({ name: 'Safeway' })
    ]);
    const existing = await request(app).post('/api/grocery/log').set('Cookie', ownerCookie)
      .send({ itemId: item.body._id, storeId: store.body._id, regularPrice: 1.29 });

    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', memberCookie)
      .send({
        itemId: item.body._id,
        storeId: store.body._id,
        regularPrice: 1.19,
        replacePriceEntryId: existing.body.entry._id
      });

    expect(res.status).toBe(403);
  });

  it('rejects item and store IDs from another household', async () => {
    const first = await createOwnerSession(app, { email: 'first@test.com', householdName: 'First' });
    const second = await createOwnerSession(app, { email: 'second@test.com', householdName: 'Second' });

    const foreignItem = await request(app).post('/api/items').set('Cookie', second.cookie)
      .send({ name: 'Foreign Item', category: 'Pantry', unit: 'each' });
    const localStore = await request(app).post('/api/stores').set('Cookie', first.cookie)
      .send({ name: 'Local Store' });

    const res = await request(app)
      .post('/api/grocery/log')
      .set('Cookie', first.cookie)
      .send({ itemId: foreignItem.body._id, storeId: localStore.body._id, regularPrice: 1.99 });

    expect(res.status).toBe(404);
  });

  it('validates price and quantity', async () => {
    const { cookie } = await createOwnerSession(app);
    const [item, store] = await Promise.all([
      request(app).post('/api/items').set('Cookie', cookie)
        .send({ name: 'Rice', category: 'Pantry', unit: 'lb' }),
      request(app).post('/api/stores').set('Cookie', cookie)
        .send({ name: 'Store' })
    ]);

    const badPrice = await request(app).post('/api/grocery/log').set('Cookie', cookie)
      .send({ itemId: item.body._id, storeId: store.body._id, regularPrice: -1 });
    expect(badPrice.status).toBe(400);

    const badQty = await request(app).post('/api/grocery/log').set('Cookie', cookie)
      .send({ itemId: item.body._id, storeId: store.body._id, regularPrice: 1, quantity: 0 });
    expect(badQty.status).toBe(400);
  });
});
