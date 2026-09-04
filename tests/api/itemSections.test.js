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

describe('item store sections', () => {
  it('returns familiar defaults plus reusable household custom sections', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie);

    const update = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ storeSection: 'Bulk Foods' });
    expect(update.status).toBe(200);

    const sections = await request(app).get('/api/item-sections').set('Cookie', cookie);
    expect(sections.status).toBe(200);
    expect(sections.body.defaults).toEqual(expect.arrayContaining(['Produce', 'Dairy & Eggs', 'Frozen', 'Other']));
    expect(sections.body.suggestions).toContain('Bulk Foods');
    expect(sections.body.saved).toContainEqual({ itemId: item.body._id, storeSection: 'Bulk Foods' });
  });

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

  it('accepts a concise custom section and preserves it verbatim', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie);

    const update = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ storeSection: 'International Foods' });

    expect(update.status).toBe(200);
    expect(update.body.storeSection).toBe('International Foods');
  });

  it('rejects empty or excessively long sections', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie);

    const empty = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ storeSection: '   ' });
    expect(empty.status).toBe(400);

    const long = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ storeSection: 'x'.repeat(81) });
    expect(long.status).toBe(400);
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
