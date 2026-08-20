const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
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

  it('returns 400 when weekStart is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie).send({ days: [] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/meal-plan/settings', () => {
  it('returns weekStartDay from household', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/meal-plan/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('weekStartDay');
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

  it('returns 403 for member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).put('/api/meal-plan/settings').set('Cookie', memberCookie)
      .send({ weekStartDay: 1 });
    expect(res.status).toBe(403);
  });
});
