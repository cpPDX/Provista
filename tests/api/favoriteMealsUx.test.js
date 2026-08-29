const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

describe('favorite meal editing', () => {
  it('updates a favorite in place while preserving its usage history', async () => {
    const { cookie } = await createOwnerSession(app);
    const created = await request(app).post('/api/meal-plan/favorites').set('Cookie', cookie)
      .send({ name: 'Tacos', notes: 'tortillas, salsa' });
    expect(created.status).toBe(200);

    const used = await request(app).post(`/api/meal-plan/favorites/${created.body._id}/use`)
      .set('Cookie', cookie).send({});
    expect(used.status).toBe(200);
    expect(used.body.useCount).toBe(1);

    const updated = await request(app).put(`/api/meal-plan/favorites/${created.body._id}`)
      .set('Cookie', cookie)
      .send({ name: 'Family Tacos', notes: 'tortillas, lettuce, salsa' });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      _id: created.body._id,
      name: 'Family Tacos',
      notes: 'tortillas, lettuce, salsa',
      useCount: 1
    });
  });

  it('allows a household member to edit a shared favorite', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const favorite = await request(app).post('/api/meal-plan/favorites').set('Cookie', ownerCookie)
      .send({ name: 'Soup', notes: 'broth' });
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);

    const updated = await request(app).put(`/api/meal-plan/favorites/${favorite.body._id}`)
      .set('Cookie', memberCookie)
      .send({ name: 'Weeknight Soup', notes: 'broth, bread' });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Weeknight Soup', notes: 'broth, bread' });
  });

  it('rejects renaming a favorite to another existing favorite name', async () => {
    const { cookie } = await createOwnerSession(app);
    const tacos = await request(app).post('/api/meal-plan/favorites').set('Cookie', cookie)
      .send({ name: 'Tacos', notes: '' });
    const soup = await request(app).post('/api/meal-plan/favorites').set('Cookie', cookie)
      .send({ name: 'Soup', notes: '' });
    expect(tacos.status).toBe(200);
    expect(soup.status).toBe(200);

    const duplicate = await request(app).put(`/api/meal-plan/favorites/${soup.body._id}`)
      .set('Cookie', cookie)
      .send({ name: '  TACOS ', notes: 'broth' });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatch(/already exists/i);
  });

  it('does not allow one household to edit another household favorite', async () => {
    const first = await createOwnerSession(app, { email: 'favorite-edit-first@test.com', householdName: 'First' });
    const second = await createOwnerSession(app, { email: 'favorite-edit-second@test.com', householdName: 'Second' });
    const favorite = await request(app).post('/api/meal-plan/favorites').set('Cookie', second.cookie)
      .send({ name: 'Private favorite', notes: '' });

    const update = await request(app).put(`/api/meal-plan/favorites/${favorite.body._id}`)
      .set('Cookie', first.cookie)
      .send({ name: 'Stolen favorite', notes: '' });

    expect(update.status).toBe(404);
  });
});
