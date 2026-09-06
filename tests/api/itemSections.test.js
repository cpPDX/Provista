const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../../server');
const Item = require('../../models/Item');
const { resolveStorePlacement } = require('../../utils/storePlacement');
const db = require('../helpers/db');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

async function createItem(cookie, name = 'Placement Test Item', category = 'Other', unit = 'each') {
  const response = await request(app)
    .post('/api/items')
    .set('Cookie', cookie)
    .send({ name, category, unit });
  expect(response.status).toBe(201);
  return response;
}

async function createStore(cookie, name = 'Placement Store') {
  const response = await request(app)
    .post('/api/stores')
    .set('Cookie', cookie)
    .send({ name });
  expect(response.status).toBe(201);
  return response.body;
}

function placementFor(response, itemId) {
  return response.body.placements.find(entry => entry.itemId === itemId);
}

describe('item store placement', () => {
  it('returns the default department/sub-section taxonomy and reusable custom values', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie);

    const update = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ department: 'Bulk Foods', subSection: 'Bins' });
    expect(update.status).toBe(200);

    const placement = await request(app).get('/api/item-sections').set('Cookie', cookie);
    expect(placement.status).toBe(200);
    expect(placement.body.departments).toEqual(expect.arrayContaining([
      'Produce',
      'Deli & Prepared Foods',
      'Pantry / Dry Grocery',
      'Health & Personal Care',
      'Other'
    ]));
    expect(placement.body.subSectionsByDepartment.Frozen).toEqual(expect.arrayContaining([
      'Vegetables',
      'Pizza',
      'Ice Cream & Desserts'
    ]));
    expect(placement.body.departmentSuggestions).toContain('Bulk Foods');
    expect(placement.body.subSectionsByDepartment['Bulk Foods']).toContain('Bins');

    const saved = placementFor(placement, item.body._id);
    expect(saved).toMatchObject({
      department: 'Bulk Foods',
      subSection: 'Bins',
      departmentProvenance: 'household_override',
      subSectionProvenance: 'household_override'
    });
  });

  it('infers normal departments and useful sub-sections without changing product category', async () => {
    const { cookie } = await createOwnerSession(app);
    const frozenPeas = await createItem(cookie, 'Frozen Peas', 'Produce', 'bag');
    const milk = await createItem(cookie, 'Whole Milk', 'Dairy', 'gal');
    const chips = await createItem(cookie, 'Potato Chips', 'Snacks', 'oz');
    const water = await createItem(cookie, 'Sparkling Water', 'Beverages', 'case');

    const placement = await request(app).get('/api/item-sections').set('Cookie', cookie);
    expect(placementFor(placement, frozenPeas.body._id)).toMatchObject({ department: 'Frozen', subSection: 'Vegetables' });
    expect(placementFor(placement, milk.body._id)).toMatchObject({ department: 'Dairy & Eggs', subSection: 'Milk & Cream' });
    expect(placementFor(placement, chips.body._id)).toMatchObject({ department: 'Pantry / Dry Grocery', subSection: 'Snacks' });
    expect(placementFor(placement, water.body._id)).toMatchObject({ department: 'Beverages', subSection: 'Water' });

    const catalog = await request(app).get('/api/items').set('Cookie', cookie);
    expect(catalog.body.find(entry => entry._id === frozenPeas.body._id)?.category).toBe('Produce');
    expect(catalog.body.find(entry => entry._id === chips.body._id)?.category).toBe('Snacks');
  });

  it('persists household corrections with independent field provenance and supports explicit sub-section clearing', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie, 'Frozen Pizza', 'Frozen', 'each');

    const departmentOnly = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ department: 'Frozen' });
    expect(departmentOnly.status).toBe(200);
    expect(departmentOnly.body.placement).toMatchObject({
      department: 'Frozen',
      subSection: 'Pizza',
      departmentProvenance: 'household_override',
      subSectionProvenance: 'inferred'
    });

    const clear = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ subSection: null });
    expect(clear.status).toBe(200);
    expect(clear.body.placement).toMatchObject({
      department: 'Frozen',
      subSection: null,
      departmentProvenance: 'household_override',
      subSectionProvenance: 'household_override'
    });
  });

  it('resolves store overrides by stable store ID and preserves lower-precedence compatible fields', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie, 'Blueberries', 'Produce', 'pint');
    const firstStore = await createStore(cookie, 'Same Display Name');
    const secondStore = await createStore(cookie, 'Same Display Name');

    const household = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ subSection: 'Fruit' });
    expect(household.status).toBe(200);

    const storeOverride = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ scope: 'store', storeId: firstStore._id, department: 'Frozen' });
    expect(storeOverride.status).toBe(200);

    const saved = await Item.findById(item.body._id);
    const firstPlacement = resolveStorePlacement(saved, firstStore._id);
    const secondPlacement = resolveStorePlacement(saved, secondStore._id);
    expect(firstPlacement).toMatchObject({
      department: 'Frozen',
      subSection: 'Fruit',
      departmentProvenance: 'store_override',
      subSectionProvenance: 'household_override'
    });
    expect(secondPlacement).toMatchObject({
      department: 'Produce',
      subSection: 'Fruit',
      departmentProvenance: 'inferred',
      subSectionProvenance: 'household_override'
    });

    expect(saved.storePlacementOverrides).toHaveLength(1);
    expect(String(saved.storePlacementOverrides[0].storeId)).toBe(firstStore._id);
  });

  it('supports a complete store-specific override without changing household placement', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie, 'Potato Chips', 'Snacks', 'oz');
    const store = await createStore(cookie);

    const household = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ department: 'Pantry / Dry Grocery', subSection: 'Snacks' });
    expect(household.status).toBe(200);

    const update = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ scope: 'store', storeId: store._id, department: 'Frozen', subSection: 'Appetizers & Snacks' });
    expect(update.status).toBe(200);

    const saved = await Item.findById(item.body._id);
    expect(resolveStorePlacement(saved, store._id)).toMatchObject({
      department: 'Frozen',
      subSection: 'Appetizers & Snacks',
      departmentProvenance: 'store_override',
      subSectionProvenance: 'store_override'
    });
    expect(resolveStorePlacement(saved, null)).toMatchObject({
      department: 'Pantry / Dry Grocery',
      subSection: 'Snacks',
      departmentProvenance: 'household_override',
      subSectionProvenance: 'household_override'
    });
  });

  it('conservatively migrates legacy storeSection values instead of reclassifying them', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie, 'Legacy Curry Paste', 'Pantry', 'jar');
    const id = new mongoose.Types.ObjectId(item.body._id);

    await Item.collection.updateOne(
      { _id: id },
      {
        $set: { storeSection: 'International Foods' },
        $unset: {
          storeDepartment: '',
          storeSubSection: '',
          storeDepartmentProvenance: '',
          storeSubSectionProvenance: '',
          storePlacementInferenceVersion: '',
          storePlacementOverrides: ''
        }
      }
    );

    const placement = await request(app).get('/api/item-sections').set('Cookie', cookie);
    expect(placement.status).toBe(200);
    expect(placementFor(placement, item.body._id)).toMatchObject({
      department: 'International Foods',
      departmentProvenance: 'legacy_preserved'
    });

    const persisted = await Item.findById(item.body._id);
    expect(persisted.storeSection).toBe('International Foods');
    expect(persisted.storeDepartment).toBe('International Foods');
    expect(persisted.storeDepartmentProvenance).toBe('legacy_preserved');
  });

  it('keeps the legacy flat correction request compatible while recording modern provenance', async () => {
    const { cookie } = await createOwnerSession(app);
    const item = await createItem(cookie);

    const update = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', cookie)
      .send({ storeSection: 'International Foods' });

    expect(update.status).toBe(200);
    expect(update.body.storeSection).toBe('International Foods');
    expect(update.body.placement).toMatchObject({
      department: 'International Foods',
      departmentProvenance: 'household_override'
    });
  });

  it('allows household members to correct placement and preserves typed custom values', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const item = await createItem(ownerCookie);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const update = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', memberCookie)
      .send({ department: 'International Market', subSection: 'Back Wall' });

    expect(update.status).toBe(200);
    expect(update.body.placement).toMatchObject({
      department: 'International Market',
      subSection: 'Back Wall',
      departmentProvenance: 'household_override',
      subSectionProvenance: 'household_override'
    });
  });

  it('rejects empty/long departments, store scope without a concrete store, and foreign household identities', async () => {
    const { cookie: firstCookie } = await createOwnerSession(app);
    const { cookie: secondCookie } = await createOwnerSession(app);
    const item = await createItem(firstCookie);
    const foreignItem = await createItem(secondCookie, 'Foreign Placement Item');
    const foreignStore = await createStore(secondCookie, 'Foreign Store');

    const empty = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', firstCookie)
      .send({ department: '   ' });
    expect(empty.status).toBe(400);

    const long = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', firstCookie)
      .send({ department: 'x'.repeat(81) });
    expect(long.status).toBe(400);

    const missingStore = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', firstCookie)
      .send({ scope: 'store', department: 'Produce' });
    expect(missingStore.status).toBe(400);

    const foreignStoreUpdate = await request(app)
      .put(`/api/item-sections/${item.body._id}`)
      .set('Cookie', firstCookie)
      .send({ scope: 'store', storeId: foreignStore._id, department: 'Produce' });
    expect(foreignStoreUpdate.status).toBe(404);

    const foreignItemUpdate = await request(app)
      .put(`/api/item-sections/${foreignItem.body._id}`)
      .set('Cookie', firstCookie)
      .send({ department: 'Frozen' });
    expect(foreignItemUpdate.status).toBe(404);
  });
});
