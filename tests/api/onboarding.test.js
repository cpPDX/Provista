const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

function localIsoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekStartSaturday() {
  const date = new Date();
  let offset = date.getDay() - 6;
  if (offset < 0) offset += 7;
  date.setDate(date.getDate() - offset);
  return localIsoDate(date);
}

async function startAndChoose(appCookie, action) {
  const started = await request(app).post('/api/onboarding/start').set('Cookie', appCookie).send({});
  expect(started.status).toBe(200);
  expect(started.body).toMatchObject({ required: true, step: 'household' });

  const people = await request(app).post('/api/onboarding/people-step').set('Cookie', appCookie)
    .send({ skipped: true });
  expect(people.status).toBe(200);
  expect(people.body).toMatchObject({ step: 'action', peopleSkipped: true });

  const selected = await request(app).post('/api/onboarding/action').set('Cookie', appCookie)
    .send({ action });
  expect(selected.status).toBe(200);
  expect(selected.body).toMatchObject({ step: 'first_action', firstAction: action });
  return selected.body;
}

describe('action-based onboarding', () => {
  it('does not opt established households in until the first-run client explicitly starts onboarding', async () => {
    const { cookie } = await createOwnerSession(app);

    const state = await request(app).get('/api/onboarding').set('Cookie', cookie);

    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      required: false,
      status: 'completed',
      step: 'completed',
      firstAction: null,
      firstUsefulAction: null
    });
  });

  it('persists people-step, back-navigation, and resume state on the household', async () => {
    const { cookie } = await createOwnerSession(app);
    await request(app).post('/api/onboarding/start').set('Cookie', cookie).send({});

    const person = await request(app).post('/api/household/people').set('Cookie', cookie)
      .send({ displayName: 'Kiddo' });
    expect(person.status).toBe(201);

    await request(app).post('/api/onboarding/people-step').set('Cookie', cookie)
      .send({ skipped: false });
    await request(app).post('/api/onboarding/action').set('Cookie', cookie)
      .send({ action: 'plan' });

    const back = await request(app).post('/api/onboarding/back').set('Cookie', cookie).send({});
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ step: 'action', firstAction: null });

    const resumed = await request(app).post('/api/onboarding/resume').set('Cookie', cookie).send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body.resumeCount).toBe(1);
    expect(resumed.body.householdPeopleCompletedAt).toBeTruthy();

    const household = await request(app).get('/api/household').set('Cookie', cookie);
    expect(household.body.people.some(entry => entry.displayName === 'Kiddo')).toBe(true);
  });

  it('cannot finish List onboarding until a real new List item is saved after the action choice', async () => {
    const { cookie } = await createOwnerSession(app);
    await startAndChoose(cookie, 'list');

    const premature = await request(app).post('/api/onboarding/complete-action').set('Cookie', cookie).send({});
    expect(premature.status).toBe(409);
    expect(premature.body.error).toMatch(/add a grocery/i);

    const catalog = await request(app).post('/api/items').set('Cookie', cookie)
      .send({ name: 'Onboarding Bananas', category: 'Produce', unit: 'each' });
    expect(catalog.status).toBe(201);

    const added = await request(app).post('/api/shopping-list').set('Cookie', cookie)
      .send({ itemId: catalog.body._id, quantity: 2 });
    expect(added.status).toBe(201);

    const completed = await request(app).post('/api/onboarding/complete-action').set('Cookie', cookie).send({});
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      required: false,
      status: 'completed',
      step: 'completed',
      firstAction: 'list',
      firstUsefulAction: 'list_item_added'
    });
    expect(completed.body.firstUsefulActionAt).toBeTruthy();
    expect(completed.body.completedAt).toBeTruthy();

    const again = await request(app).post('/api/onboarding/complete-action').set('Cookie', cookie).send({});
    expect(again.status).toBe(200);
    expect(again.body.completedAt).toBe(completed.body.completedAt);
  });

  it('cannot finish Plan onboarding until a named meal is persisted after the action choice', async () => {
    const { cookie } = await createOwnerSession(app);
    await startAndChoose(cookie, 'plan');

    const premature = await request(app).post('/api/onboarding/complete-action').set('Cookie', cookie).send({});
    expect(premature.status).toBe(409);
    expect(premature.body.error).toMatch(/plan a meal/i);

    const weekStart = weekStartSaturday();
    const plan = await request(app).get(`/api/meal-plan?weekStart=${weekStart}`).set('Cookie', cookie);
    expect(plan.status).toBe(200);
    const today = localIsoDate();
    const day = plan.body.days.find(entry => String(entry.date).slice(0, 10) === today) || plan.body.days[0];
    const dinner = day.meals.find(meal => meal.mealType === 'dinner');
    dinner.name = 'Sheet-pan dinner';

    const saved = await request(app).put('/api/meal-plan').set('Cookie', cookie).send({
      weekStart,
      days: plan.body.days,
      produceNotes: '',
      shoppingNotes: ''
    });
    expect(saved.status).toBe(200);

    const completed = await request(app).post('/api/onboarding/complete-action').set('Cookie', cookie).send({});
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      required: false,
      status: 'completed',
      firstAction: 'plan',
      firstUsefulAction: 'meal_planned'
    });
  });

  it('stores progress metadata without copying grocery, meal, or dietary content into onboarding state', async () => {
    const { cookie } = await createOwnerSession(app);
    await startAndChoose(cookie, 'list');

    const state = await request(app).get('/api/onboarding').set('Cookie', cookie);
    const serialized = JSON.stringify(state.body);

    expect(serialized).not.toContain('groceryText');
    expect(serialized).not.toContain('mealText');
    expect(serialized).not.toContain('dietary');
    expect(Object.keys(state.body)).toEqual(expect.arrayContaining([
      'required',
      'status',
      'step',
      'firstAction',
      'firstUsefulAction',
      'resumeCount'
    ]));
  });
});
