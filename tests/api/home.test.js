const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const MealPlan = require('../../models/MealPlan');
const { createOwnerSession } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

describe('GET /api/home', () => {
  it('summarizes dinner, shopping needs, and low stock for Today', async () => {
    const { cookie, user } = await createOwnerSession(app);
    const itemRes = await request(app).post('/api/items').set('Cookie', cookie)
      .send({ name: 'Milk', category: 'Dairy', unit: 'gal' });
    const itemId = itemRes.body._id;

    await request(app).post('/api/shopping-list').set('Cookie', cookie)
      .send({ itemId, quantity: 1 });
    await request(app).post('/api/inventory').set('Cookie', cookie)
      .send({ itemId, quantity: 0.5, unit: 'gal', lowStockThreshold: 1 });

    const date = '2026-08-20';
    const day = new Date(`${date}T00:00:00.000Z`);
    await MealPlan.create({
      householdId: user.householdId,
      weekStart: day,
      days: [{
        date: day,
        meals: [{
          mealType: 'dinner',
          forEveryone: true,
          name: 'Tacos',
          notes: 'tortillas, lettuce, salsa'
        }]
      }]
    });

    const res = await request(app).get(`/api/home?date=${date}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.dinner).toHaveLength(1);
    expect(res.body.dinner[0].name).toBe('Tacos');
    expect(res.body.shoppingCount).toBe(1);
    expect(res.body.lowStock).toHaveLength(1);
    expect(res.body.lowStock[0].name).toBe('Milk');
    expect(res.body.nextAction.tab).toBe('list');
  });

  it('makes planning dinner the next action when dinner is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/home?date=2026-08-20').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.dinner).toEqual([]);
    expect(res.body.nextAction.tab).toBe('meal-plan');
  });

  it('requires a local calendar date', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/home').set('Cookie', cookie);
    expect(res.status).toBe(400);
  });
});
