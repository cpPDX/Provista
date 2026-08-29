const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function createItem(cookie, overrides = {}) {
  const res = await request(app)
    .post('/api/items')
    .set('Cookie', cookie)
    .send({ name: 'Apples', category: 'Produce', unit: 'lb', ...overrides });
  return res;
}

describe('POST /api/items', () => {
  it('owner can create an item', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await createItem(cookie);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Apples');
    expect(res.body.category).toBe('Produce');
  });

  it('returns 400 when name is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await createItem(cookie, { name: undefined });
    expect(res.status).toBe(400);
  });

  it('lets a member add a non-destructive catalog item', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await createItem(memberCookie);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Apples');
  });
});

describe('GET /api/items', () => {
  it('returns items for the household', async () => {
    const { cookie } = await createOwnerSession(app);
    // seedHousehold adds items automatically on register, so there should be items
    const res = await request(app).get('/api/items').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('filters by search query', async () => {
    const { cookie } = await createOwnerSession(app);
    await createItem(cookie, { name: 'Organic Banana', category: 'Produce', unit: 'each' });
    const res = await request(app).get('/api/items?search=banana').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.some(i => i.name.toLowerCase().includes('banana'))).toBe(true);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/items');
    expect(res.status).toBe(401);
  });

  it('member can list items', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).get('/api/items').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
  });

  it('does not return items from other households', async () => {
    const { cookie: cookie1 } = await createOwnerSession(app);
    const { cookie: cookie2 } = await createOwnerSession(app);
    await createItem(cookie1, { name: 'House1 Only Item', category: 'Produce', unit: 'lb' });
    const res = await request(app).get('/api/items?search=House1 Only').set('Cookie', cookie2);
    expect(res.status).toBe(200);
    expect(res.body.every(i => i.name !== 'House1 Only Item')).toBe(true);
  });
});

describe('POST /api/items/match', () => {
  it('parses several groceries with the shared deterministic matcher', async () => {
    const { cookie } = await createOwnerSession(app);
    const itemName = 'API Match Black Beans';
    await createItem(cookie, { name: itemName, category: 'Pantry', unit: 'can' });

    const res = await request(app)
      .post('/api/items/match')
      .set('Cookie', cookie)
      .send({ text: `2 cans ${itemName}, mystery grocery` });

    expect(res.status).toBe(200);
    expect(res.body.parsedCount).toBe(2);
    expect(res.body.suggestions[0]).toMatchObject({
      sourceText: itemName,
      quantity: 2,
      matchStatus: 'matched',
      item: { name: itemName }
    });
    expect(res.body.suggestions[1]).toMatchObject({
      sourceText: 'mystery grocery',
      matchStatus: 'unmatched',
      item: null
    });
  });

  it('never matches an item or alias from another household', async () => {
    const { cookie: cookie1 } = await createOwnerSession(app);
    const { cookie: cookie2 } = await createOwnerSession(app);
    const { body: item } = await createItem(cookie1, {
      name: 'Cheerios',
      category: 'Cereal',
      unit: 'box'
    });

    const aliasRes = await request(app)
      .post(`/api/items/${item._id}/aliases`)
      .set('Cookie', cookie1)
      .send({ text: 'GM CHEER 18OZ', source: 'receipt' });
    expect(aliasRes.status).toBe(201);

    const res = await request(app)
      .post('/api/items/match')
      .set('Cookie', cookie2)
      .send({ text: 'GM CHEER 18OZ' });

    expect(res.status).toBe(200);
    expect(res.body.suggestions[0]).toMatchObject({ matchStatus: 'unmatched', item: null });
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post('/api/items/match')
      .send({ text: 'milk' });
    expect(res.status).toBe(401);
  });
});

describe('item aliases', () => {
  it('learns a confirmed alias and resolves it before fuzzy matching', async () => {
    const { cookie } = await createOwnerSession(app);
    const { body: item } = await createItem(cookie, {
      name: 'Cheerios',
      category: 'Cereal',
      unit: 'box'
    });

    const createAlias = await request(app)
      .post(`/api/items/${item._id}/aliases`)
      .set('Cookie', cookie)
      .send({ text: 'GM CHEER 18OZ', source: 'receipt' });

    expect(createAlias.status).toBe(201);
    expect(createAlias.body.alias).toMatchObject({ text: 'GM CHEER 18OZ', source: 'receipt' });

    const match = await request(app)
      .post('/api/items/match')
      .set('Cookie', cookie)
      .send({ text: 'GM CHEER 18OZ' });

    expect(match.status).toBe(200);
    expect(match.body.suggestions[0]).toMatchObject({
      matchStatus: 'matched',
      matchSource: 'alias',
      item: { _id: item._id, name: 'Cheerios' }
    });
  });

  it('rejects an alias already owned by another catalog item', async () => {
    const { cookie } = await createOwnerSession(app);
    const { body: cheerios } = await createItem(cookie, {
      name: 'Cheerios',
      category: 'Cereal',
      unit: 'box'
    });
    const { body: cornFlakes } = await createItem(cookie, {
      name: 'Corn Flakes',
      category: 'Cereal',
      unit: 'box'
    });

    const first = await request(app)
      .post(`/api/items/${cheerios._id}/aliases`)
      .set('Cookie', cookie)
      .send({ text: 'breakfast box' });
    expect(first.status).toBe(201);

    const conflict = await request(app)
      .post(`/api/items/${cornFlakes._id}/aliases`)
      .set('Cookie', cookie)
      .send({ text: 'breakfast box' });
    expect(conflict.status).toBe(409);
  });

  it('lets a household remove a bad learned alias', async () => {
    const { cookie } = await createOwnerSession(app);
    const { body: item } = await createItem(cookie, {
      name: 'Cheerios',
      category: 'Cereal',
      unit: 'box'
    });
    const createAlias = await request(app)
      .post(`/api/items/${item._id}/aliases`)
      .set('Cookie', cookie)
      .send({ text: 'GM CHEER 18OZ', source: 'receipt' });
    expect(createAlias.status).toBe(201);

    const removeAlias = await request(app)
      .delete(`/api/items/${item._id}/aliases/${createAlias.body.alias._id}`)
      .set('Cookie', cookie);
    expect(removeAlias.status).toBe(200);

    const match = await request(app)
      .post('/api/items/match')
      .set('Cookie', cookie)
      .send({ text: 'GM CHEER 18OZ' });
    expect(match.status).toBe(200);
    expect(match.body.suggestions[0]).toMatchObject({ matchStatus: 'unmatched', item: null });
  });
});

describe('PUT /api/items/:id', () => {
  it('owner can update an item', async () => {
    const { cookie } = await createOwnerSession(app);
    const { body: item } = await createItem(cookie);
    const res = await request(app)
      .put(`/api/items/${item._id}`)
      .set('Cookie', cookie)
      .send({ name: 'Updated Apples' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Apples');
  });

  it('returns 403 when called by member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const { body: item } = await createItem(ownerCookie);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .put(`/api/items/${item._id}`)
      .set('Cookie', memberCookie)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/items/:id', () => {
  it('owner can delete an item', async () => {
    const { cookie } = await createOwnerSession(app);
    const { body: item } = await createItem(cookie);
    const res = await request(app).delete(`/api/items/${item._id}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 403 when called by member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const { body: item } = await createItem(ownerCookie);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).delete(`/api/items/${item._id}`).set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});
