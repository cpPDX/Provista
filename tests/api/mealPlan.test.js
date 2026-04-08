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

  it('scaffold includes 4 meal types per day', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    const mealTypes = [...new Set(res.body.days[0].meals.map(m => m.mealType))];
    expect(mealTypes).toEqual(expect.arrayContaining(['breakfast', 'lunch', 'dinner', 'special']));
  });

  it('scaffold includes a row per household member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    await createMemberSession(app, code);
    const res = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', ownerCookie);
    expect(res.status).toBe(200);
    // 2 household members × 4 meal types = 8 meals per day
    expect(res.body.days[0].meals.length).toBe(8);
  });

  it('returns saved plan when one exists', async () => {
    const { cookie } = await createOwnerSession(app);
    await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days: [], produceNotes: 'Kale', shoppingNotes: '' });
    const res = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body._scaffold).toBeUndefined();
    expect(res.body.produceNotes).toBe('Kale');
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
  it('admin can save a meal plan', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days: [], produceNotes: 'Carrots', shoppingNotes: 'Restock rice' });
    expect(res.status).toBe(200);
    expect(res.body.produceNotes).toBe('Carrots');
    expect(res.body.shoppingNotes).toBe('Restock rice');
  });

  it('returns 403 for member', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app).put('/api/meal-plan').set('Cookie', memberCookie)
      .send({ weekStart: WEEK_START, days: [] });
    expect(res.status).toBe(403);
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
