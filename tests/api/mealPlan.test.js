const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const MealPlan = require('../../models/MealPlan');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

const WEEK_START = '2026-01-05';

describe('GET /api/meal-plan', () => {
  it('returns scaffold when no plan exists for that week', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body._scaffold).toBe(true);
    expect(Array.isArray(res.body.days)).toBe(true);
    expect(res.body.days.length).toBe(7);
  });

  it('scaffold includes one Everyone row for each meal type', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    await createMemberSession(app, code);

    const res = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(res.body.days[0].meals).toHaveLength(4);
    expect(res.body.days[0].meals.map(m => m.mealType)).toEqual(
      expect.arrayContaining(['breakfast', 'lunch', 'dinner', 'special'])
    );
    expect(res.body.days[0].meals.every(m => m.forEveryone === true)).toBe(true);
    expect(res.body.days[0].meals.every(m => Array.isArray(m.personIds) && m.personIds.length === 0)).toBe(true);
  });

  it('returns household people separately from meal rows', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    await createMemberSession(app, code);

    const res = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.people)).toBe(true);
    expect(res.body.people).toHaveLength(2);
    expect(res.body.people.every(p => p.displayName)).toBe(true);
  });

  it('returns saved plan when one exists', async () => {
    const { cookie } = await createOwnerSession(app);
    await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days: [], produceNotes: 'Kale', shoppingNotes: '' });
    const res = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body._scaffold).toBeUndefined();
    expect(res.body.produceNotes).toBe('Kale');
    expect(Array.isArray(res.body.people)).toBe(true);
  });

  it('does not default a legacy person-specific meal to Everyone', async () => {
    const { cookie, user } = await createOwnerSession(app, { name: 'Legacy Person' });
    const householdId = new mongoose.Types.ObjectId(String(user.householdId));
    const now = new Date();

    await MealPlan.collection.insertOne({
      householdId,
      weekStart: new Date(`${WEEK_START}T00:00:00.000Z`),
      days: [{
        date: new Date(`${WEEK_START}T00:00:00.000Z`),
        specialCollapsed: true,
        meals: [{ mealType: 'dinner', personName: 'Legacy Person', name: 'Legacy dinner' }]
      }],
      produceNotes: '',
      shoppingNotes: '',
      createdAt: now,
      updatedAt: now
    });

    const res = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    const meal = res.body.days[0].meals[0];
    expect(meal.personName).toBe('Legacy Person');
    expect(meal).not.toHaveProperty('forEveryone');
  });

  it('returns inactive people that are still referenced by historical meal audiences', async () => {
    const { cookie } = await createOwnerSession(app);
    const person = await request(app).post('/api/household/people').set('Cookie', cookie)
      .send({ displayName: 'Former Guest' });
    expect(person.status).toBe(201);

    const days = [{
      date: `${WEEK_START}T00:00:00.000Z`,
      specialCollapsed: true,
      meals: [{ mealType: 'dinner', name: 'Old dinner', forEveryone: false, personIds: [person.body._id] }]
    }];
    const save = await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days });
    expect(save.status).toBe(200);

    const removed = await request(app).delete(`/api/household/people/${person.body._id}`).set('Cookie', cookie);
    expect(removed.status).toBe(200);

    const loaded = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', cookie);
    expect(loaded.status).toBe(200);
    const historical = loaded.body.people.find(p => p._id === person.body._id);
    expect(historical).toBeTruthy();
    expect(historical.active).toBe(false);
    expect(loaded.body.days[0].meals[0].personIds.map(String)).toContain(String(person.body._id));
  });

  it('returns 400 when weekStart is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/meal-plan').set('Cookie', cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when weekStart is invalid', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/meal-plan?weekStart=notadate').set('Cookie', cookie);
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/meal-plan', () => {
  it('owner can save a meal plan', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days: [], produceNotes: 'Carrots', shoppingNotes: 'Restock rice' });
    expect(res.status).toBe(200);
    expect(res.body.produceNotes).toBe('Carrots');
    expect(res.body.shoppingNotes).toBe('Restock rice');
  });

  it('member can collaborate on the household meal plan', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).put('/api/meal-plan').set('Cookie', memberCookie)
      .send({ weekStart: WEEK_START, days: [], shoppingNotes: 'Need milk' });
    expect(res.status).toBe(200);
    expect(res.body.shoppingNotes).toBe('Need milk');
  });

  it('persists per-meal notes and audience selection', async () => {
    const { cookie } = await createOwnerSession(app);
    const household = await request(app).get('/api/household').set('Cookie', cookie);
    const personId = household.body.people[0]._id;

    const days = [{
      date: `${WEEK_START}T00:00:00.000Z`,
      specialCollapsed: true,
      meals: [{
        mealType: 'dinner',
        name: 'Tacos',
        notes: 'Need tortillas, lettuce, and salsa',
        forEveryone: false,
        personIds: [personId]
      }]
    }];

    const save = await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days });
    expect(save.status).toBe(200);
    expect(save.body.days[0].meals[0].notes).toBe('Need tortillas, lettuce, and salsa');
    expect(save.body.days[0].meals[0].forEveryone).toBe(false);
    expect(save.body.days[0].meals[0].personIds.map(String)).toContain(String(personId));
  });

  it('rejects audience people from another household', async () => {
    const first = await createOwnerSession(app, { email: 'meal-first@test.com', householdName: 'First' });
    const second = await createOwnerSession(app, { email: 'meal-second@test.com', householdName: 'Second' });

    const foreignHousehold = await request(app).get('/api/household').set('Cookie', second.cookie);
    const foreignPersonId = foreignHousehold.body.people[0]._id;

    const days = [{
      date: `${WEEK_START}T00:00:00.000Z`,
      specialCollapsed: true,
      meals: [{
        mealType: 'dinner',
        name: 'Private dinner',
        forEveryone: false,
        personIds: [foreignPersonId]
      }]
    }];

    const res = await request(app).put('/api/meal-plan').set('Cookie', first.cookie)
      .send({ weekStart: WEEK_START, days });

    expect(res.status).toBe(400);
  });

  it('rejects a selected-people meal with nobody selected', async () => {
    const { cookie } = await createOwnerSession(app);
    const days = [{
      date: `${WEEK_START}T00:00:00.000Z`,
      specialCollapsed: true,
      meals: [{ mealType: 'dinner', name: 'Nobody dinner', forEveryone: false, personIds: [], personName: '' }]
    }];
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one person/i);
  });

  it('preserves unmatched legacy personName while migration is in progress', async () => {
    const { cookie } = await createOwnerSession(app);
    const days = [{
      date: `${WEEK_START}T00:00:00.000Z`,
      specialCollapsed: true,
      meals: [{ mealType: 'dinner', name: 'Legacy dinner', forEveryone: false, personIds: [], personName: 'Legacy Person' }]
    }];
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days });
    expect(res.status).toBe(200);
    expect(res.body.days[0].meals[0].personName).toBe('Legacy Person');
  });

  it('returns 400 when weekStart is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie).send({ days: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/meal-plan/shopping-suggestions', () => {
  it('matches meal notes while flagging List duplicates and Pantry items', async () => {
    const { cookie } = await createOwnerSession(app);
    const createItem = name => request(app).post('/api/items').set('Cookie', cookie)
      .send({ name, category: 'Other', unit: 'each' });
    const [tortillas, lettuce, salsa] = await Promise.all([
      createItem('Meal Tortillas'),
      createItem('Meal Lettuce'),
      createItem('Meal Salsa')
    ]);
    expect(tortillas.status).toBe(201);
    expect(lettuce.status).toBe(201);
    expect(salsa.status).toBe(201);
    const pantrySetup = await request(app).post('/api/inventory').set('Cookie', cookie)
      .send({ itemId: tortillas.body._id, quantity: 2 });
    const listSetup = await request(app).post('/api/shopping-list').set('Cookie', cookie)
      .send({ itemId: lettuce.body._id, quantity: 1 });
    expect(pantrySetup.status).toBe(201);
    expect(listSetup.status).toBe(201);

    const res = await request(app).post('/api/meal-plan/shopping-suggestions').set('Cookie', cookie)
      .send({ notes: 'Need Meal Tortillas, Meal Lettuce, and Meal Salsa x2' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ parsedCount: 3, matchedCount: 3, ambiguousCount: 0, unmatchedCount: 0 });
    const bySource = Object.fromEntries(res.body.suggestions.map(suggestion => [suggestion.sourceText, suggestion]));
    expect(bySource['Meal Tortillas'].item).toMatchObject({ _id: tortillas.body._id, pantryQuantity: 2, onList: false });
    expect(bySource['Meal Lettuce'].item).toMatchObject({ _id: lettuce.body._id, onList: true });
    expect(bySource['Meal Salsa']).toMatchObject({ quantity: 2, item: { _id: salsa.body._id } });
  });

  it('does not expose catalog items from another household', async () => {
    const first = await createOwnerSession(app, { email: 'meal-suggest-first@test.com', householdName: 'First' });
    const second = await createOwnerSession(app, { email: 'meal-suggest-second@test.com', householdName: 'Second' });
    await request(app).post('/api/items').set('Cookie', second.cookie)
      .send({ name: 'Secret Ingredient ZXQ', category: 'Other', unit: 'each' });

    const res = await request(app).post('/api/meal-plan/shopping-suggestions').set('Cookie', first.cookie)
      .send({ notes: 'Secret Ingredient ZXQ' });
    expect(res.status).toBe(200);
    expect(res.body.suggestions[0]).toMatchObject({ matchStatus: 'unmatched', candidates: [] });
  });

  it('rejects oversized notes', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).post('/api/meal-plan/shopping-suggestions').set('Cookie', cookie)
      .send({ notes: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/meal-plan/allocations', () => {
  it('projects chronological meal demand without changing Pantry quantity', async () => {
    const { cookie } = await createOwnerSession(app);
    const chicken = await request(app).post('/api/items').set('Cookie', cookie)
      .send({ name: 'Allocation Chicken', category: 'Meat', unit: 'each' });
    expect(chicken.status).toBe(201);

    const pantry = await request(app).post('/api/inventory').set('Cookie', cookie)
      .send({ itemId: chicken.body._id, trackingMode: 'exact', quantity: 4 });
    expect(pantry.status).toBe(201);

    const saved = await request(app).put('/api/meal-plan').set('Cookie', cookie).send({
      weekStart: WEEK_START,
      days: [{
        date: `${WEEK_START}T00:00:00.000Z`,
        meals: [{ mealType: 'dinner', name: 'Monday', notes: 'Allocation Chicken x2', forEveryone: true }]
      }, {
        date: '2026-01-07T00:00:00.000Z',
        meals: [{ mealType: 'dinner', name: 'Wednesday', notes: 'Allocation Chicken x3', forEveryone: true }]
      }]
    });
    expect(saved.status).toBe(200);

    const projection = await request(app)
      .get(`/api/meal-plan/allocations?weekStart=${WEEK_START}`)
      .set('Cookie', cookie);
    expect(projection.status).toBe(200);
    expect(projection.body.itemSummaries[0]).toMatchObject({
      itemId: chicken.body._id,
      onHandQuantity: 4,
      plannedQuantity: 5,
      projectedQuantity: 0,
      shortageQuantity: 1,
      shoppingQuantity: 1
    });
    expect(projection.body.mealAllocations[1]).toMatchObject({
      mealName: 'Wednesday',
      availableBefore: 2,
      shortageQuantity: 1,
      shoppingQuantity: 1
    });

    const inventory = await request(app).get('/api/inventory').set('Cookie', cookie);
    expect(inventory.status).toBe(200);
    expect(inventory.body.find(entry => entry.itemId?._id === chicken.body._id)?.quantity).toBe(4);
  });

  it('subtracts existing List quantity from the projected shopping need', async () => {
    const { cookie } = await createOwnerSession(app);
    const onion = await request(app).post('/api/items').set('Cookie', cookie)
      .send({ name: 'Allocation Onion', category: 'Produce', unit: 'each' });
    expect(onion.status).toBe(201);
    await request(app).post('/api/inventory').set('Cookie', cookie)
      .send({ itemId: onion.body._id, trackingMode: 'exact', quantity: 1 });
    await request(app).post('/api/shopping-list').set('Cookie', cookie)
      .send({ itemId: onion.body._id, quantity: 0.5 });
    await request(app).put('/api/meal-plan').set('Cookie', cookie).send({
      weekStart: WEEK_START,
      days: [{
        date: `${WEEK_START}T00:00:00.000Z`,
        meals: [{ mealType: 'dinner', name: 'Soup', notes: 'Allocation Onion x1.75', forEveryone: true }]
      }]
    });

    const projection = await request(app)
      .get(`/api/meal-plan/allocations?weekStart=${WEEK_START}`)
      .set('Cookie', cookie);
    expect(projection.status).toBe(200);
    expect(projection.body.itemSummaries[0]).toMatchObject({
      onHandQuantity: 1,
      plannedQuantity: 1.75,
      shortageQuantity: 0.75,
      listQuantity: 0.5,
      shoppingQuantity: 0.25
    });
  });

  it('requires a valid week start', async () => {
    const { cookie } = await createOwnerSession(app);
    const missing = await request(app).get('/api/meal-plan/allocations').set('Cookie', cookie);
    const invalid = await request(app).get('/api/meal-plan/allocations?weekStart=nope').set('Cookie', cookie);
    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
  });
});

describe('POST /api/meal-plan/copy-previous', () => {
  it('copies last week while remapping dates to the requested week', async () => {
    const { cookie } = await createOwnerSession(app);
    const previousWeek = '2025-12-29';
    const previous = await request(app).put('/api/meal-plan').set('Cookie', cookie).send({
      weekStart: previousWeek,
      produceNotes: 'Use cilantro',
      shoppingNotes: 'Check beans',
      days: [{
        date: `${previousWeek}T00:00:00.000Z`,
        specialCollapsed: true,
        meals: [{
          mealType: 'dinner',
          name: 'Tacos',
          notes: 'tortillas, salsa',
          forEveryone: true,
          personIds: []
        }]
      }]
    });
    expect(previous.status).toBe(200);

    const copied = await request(app).post('/api/meal-plan/copy-previous').set('Cookie', cookie)
      .send({ weekStart: WEEK_START });
    expect(copied.status).toBe(200);
    expect(copied.body.days).toHaveLength(7);
    expect(copied.body.days[0].date).toBe(`${WEEK_START}T00:00:00.000Z`);
    expect(copied.body.days[0].meals[0]).toMatchObject({
      mealType: 'dinner',
      name: 'Tacos',
      notes: 'tortillas, salsa'
    });
    expect(copied.body).toMatchObject({ produceNotes: 'Use cilantro', shoppingNotes: 'Check beans' });
  });

  it('returns 404 without exposing another household’s previous week', async () => {
    const first = await createOwnerSession(app, { email: 'copy-first@test.com', householdName: 'First' });
    const second = await createOwnerSession(app, { email: 'copy-second@test.com', householdName: 'Second' });
    await request(app).put('/api/meal-plan').set('Cookie', second.cookie)
      .send({ weekStart: '2025-12-29', days: [] });

    const copied = await request(app).post('/api/meal-plan/copy-previous').set('Cookie', first.cookie)
      .send({ weekStart: WEEK_START });
    expect(copied.status).toBe(404);
  });
});

describe('favorite meals', () => {
  it('saves notes with a favorite and updates duplicate names instead of duplicating them', async () => {
    const { cookie } = await createOwnerSession(app);
    const first = await request(app).post('/api/meal-plan/favorites').set('Cookie', cookie)
      .send({ name: 'Tacos', notes: 'tortillas, salsa' });
    const updated = await request(app).post('/api/meal-plan/favorites').set('Cookie', cookie)
      .send({ name: '  TACOS  ', notes: 'tortillas, lettuce, salsa' });
    expect(first.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(updated.body._id).toBe(first.body._id);
    expect(updated.body.notes).toBe('tortillas, lettuce, salsa');

    const list = await request(app).get('/api/meal-plan/favorites').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('lets members use and remove household favorites', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const favorite = await request(app).post('/api/meal-plan/favorites').set('Cookie', ownerCookie)
      .send({ name: 'Soup', notes: 'broth x2' });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const used = await request(app).post(`/api/meal-plan/favorites/${favorite.body._id}/use`)
      .set('Cookie', memberCookie).send({});
    expect(used.status).toBe(200);
    expect(used.body.useCount).toBe(1);
    const removed = await request(app).delete(`/api/meal-plan/favorites/${favorite.body._id}`)
      .set('Cookie', memberCookie);
    expect(removed.status).toBe(200);
  });

  it('keeps favorites scoped to their household', async () => {
    const first = await createOwnerSession(app, { email: 'favorite-first@test.com', householdName: 'First' });
    const second = await createOwnerSession(app, { email: 'favorite-second@test.com', householdName: 'Second' });
    const favorite = await request(app).post('/api/meal-plan/favorites').set('Cookie', second.cookie)
      .send({ name: 'Private favorite', notes: '' });

    const use = await request(app).post(`/api/meal-plan/favorites/${favorite.body._id}/use`)
      .set('Cookie', first.cookie).send({});
    const remove = await request(app).delete(`/api/meal-plan/favorites/${favorite.body._id}`)
      .set('Cookie', first.cookie);
    expect(use.status).toBe(404);
    expect(remove.status).toBe(404);
  });
});

describe('GET /api/meal-plan/settings', () => {
  it('returns weekStartDay from household', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/meal-plan/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('weekStartDay');
    expect(res.body.mealPlanMode).toBe('dinner');
  });

  it('member can access settings', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).get('/api/meal-plan/settings').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/meal-plan/settings', () => {
  it('admin can switch between Dinner only and All meals', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan/settings').set('Cookie', cookie)
      .send({ mealPlanMode: 'all' });
    expect(res.status).toBe(200);
    expect(res.body.mealPlanMode).toBe('all');
  });

  it('admin can set weekStartDay to 0 (Sunday)', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan/settings').set('Cookie', cookie)
      .send({ weekStartDay: 0 });
    expect(res.status).toBe(200);
    expect(res.body.weekStartDay).toBe(0);
  });

  it('admin can set weekStartDay to 1 (Monday)', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan/settings').set('Cookie', cookie)
      .send({ weekStartDay: 1 });
    expect(res.status).toBe(200);
    expect(res.body.weekStartDay).toBe(1);
  });

  it('returns 400 for invalid weekStartDay', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan/settings').set('Cookie', cookie)
      .send({ weekStartDay: 3 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid mealPlanMode', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan/settings').set('Cookie', cookie)
      .send({ mealPlanMode: 'snacks' });
    expect(res.status).toBe(400);
  });

  it('returns 403 for member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).put('/api/meal-plan/settings').set('Cookie', memberCookie)
      .send({ weekStartDay: 1 });
    expect(res.status).toBe(403);
  });
});
