const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function createItem(cookie, name = 'Section Test Item') {
  return request(app)
    .post('/api/items')
    .set('Cookie', cookie)
    .send({ name, category: 'Other', unit: 'each' });
}

describe('PUT /api/item-sections/:id', () => {
  it('persists a household store-section correction', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie);

    const update = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ storeSection: 'Produce' });

    expect(update.status).toBe(200);
    expect(update.body.storeSection).toBe('Produce');

    const catalog = await request(app).get('/api/items').set('Cookie', cookie);
    expect(catalog.body.find(entry => entry._id === item.body._id)?.storeSection).toBe('Produce');
  });

  it('allows a household member to correct a section', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const item = await createItem(ownerCookie);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const update = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', memberCookie)
      .send({ storeSection: 'Household' });

    expect(update.status).toBe(200);
    expect(update.body.storeSection).toBe('Household');
  });

  it('rejects unknown sections instead of guessing', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie);

    const update = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ storeSection: 'Aisle 12' });

    expect(update.status).toBe(400);
  });

  it('cannot update an item from another household', async () => {
    const { cookie: firstCookie } = await createOwnerSession(app);
    const { cookie: secondCookie } = await createOwnerSession(app);
    const foreignItem = await createItem(secondCookie, 'Foreign Section Item');

    const update = await request(app)
      .put(`/api/item-sections/${foreignItem.body._id}`)
      .set('Cookie', firstCookie)
      .send({ storeSection: 'Frozen' });

    expect(update.status).toBe(404);
  });
});
