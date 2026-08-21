const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const FavoriteMeal = require('../../models/FavoriteMeal');
const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

describe('POST /api/auth/register', () => {
  it('returns 201, sets cookie, and defaults display name to first name', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice Example', email: 'alice@test.com', password: 'password123', action: 'create', householdName: 'Alices House' });
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.body.user.role).toBe('owner');
    expect(res.body.user.householdId).toBeTruthy();
    expect(res.body.user.displayName).toBe('Alice');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@test.com', password: 'password123', action: 'create', householdName: 'H' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', password: 'password123', action: 'create', householdName: 'H' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email: 'a@test.com', password: 'abc', action: 'create', householdName: 'H' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when action is create but householdName is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email: 'a@test.com', password: 'password123', action: 'create' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when action is neither create nor join', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email: 'a@test.com', password: 'password123', action: 'other' });
    expect(res.status).toBe(400);
  });

  it('returns 409 when email is already registered', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email: 'dup@test.com', password: 'password123', action: 'create', householdName: 'H' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice2', email: 'dup@test.com', password: 'password123', action: 'create', householdName: 'H2' });
    expect(res.status).toBe(409);
  });

  it('returns 201 when joining with valid invite code', async () => {
    const { cookie } = await createOwnerSession(app);
    const invRes = await request(app).get('/api/household/invite').set('Cookie', cookie);
    const inviteCode = invRes.body.inviteCode;

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bob Example', email: 'bob@test.com', password: 'password123', action: 'join', inviteCode });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('member');
    expect(res.body.user.displayName).toBe('Bob');
  });

  it('returns 400 when joining with invalid invite code', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bob', email: 'bob@test.com', password: 'password123', action: 'join', inviteCode: 'INVALID' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when action is join but inviteCode is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bob', email: 'bob@test.com', password: 'password123', action: 'join' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice Example', email: 'alice@test.com', password: 'password123', action: 'create', householdName: 'H' });
  });

  it('returns 200 and sets cookie with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.body.user.email).toBe('alice@test.com');
    expect(res.body.user.displayName).toBe('Alice');
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@test.com' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when email does not exist', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nope@test.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when password is wrong', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@test.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
  });
});

describe('password recovery', () => {
  it('offers an enumeration-safe reset flow and invalidates the link after use', async () => {
    const originalApiKey = process.env.RESEND_API_KEY;
    const originalFrom = process.env.PASSWORD_RESET_FROM;
    process.env.RESEND_API_KEY = '';
    process.env.PASSWORD_RESET_FROM = '';
    try {
      await createOwnerSession(app, { email: 'recover@test.com' });

      const existing = await request(app).post('/api/auth/forgot-password')
        .send({ email: 'recover@test.com' });
      const missing = await request(app).post('/api/auth/forgot-password')
        .send({ email: 'unknown-recovery@test.com' });
      expect(existing.status).toBe(200);
      expect(missing.status).toBe(200);
      expect(existing.body.message).toBe(missing.body.message);
      expect(existing.body.resetUrl).toBeTruthy();
      expect(missing.body.resetUrl).toBeUndefined();

      const resetUrl = new URL(existing.body.resetUrl);
      const payload = {
        email: resetUrl.searchParams.get('email'),
        token: resetUrl.searchParams.get('token'),
        newPassword: 'replacement456'
      };
      const reset = await request(app).post('/api/auth/reset-password').send(payload);
      expect(reset.status).toBe(200);
      expect(reset.body.success).toBe(true);

      const oldLogin = await request(app).post('/api/auth/login')
        .send({ email: 'recover@test.com', password: 'password123' });
      const newLogin = await request(app).post('/api/auth/login')
        .send({ email: 'recover@test.com', password: 'replacement456' });
      const reused = await request(app).post('/api/auth/reset-password').send(payload);
      expect(oldLogin.status).toBe(401);
      expect(newLogin.status).toBe(200);
      expect(reused.status).toBe(400);
    } finally {
      if (originalApiKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = originalApiKey;
      if (originalFrom === undefined) delete process.env.PASSWORD_RESET_FROM;
      else process.env.PASSWORD_RESET_FROM = originalFrom;
    }
  });

  it('rejects incomplete and short reset requests', async () => {
    const incomplete = await request(app).post('/api/auth/reset-password')
      .send({ email: 'somebody@test.com' });
    const short = await request(app).post('/api/auth/reset-password')
      .send({ email: 'somebody@test.com', token: 'token', newPassword: 'short' });
    expect(incomplete.status).toBe(400);
    expect(short.status).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/auth/me', () => {
  it('returns user, display name, and household with valid cookie', async () => {
    const { cookie } = await createOwnerSession(app, { name: 'Test Owner' });
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.displayName).toBe('Test');
    expect(res.body.household).toBeDefined();
  });

  it('returns 401 without cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with invalid cookie', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'token=badtoken');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/profile', () => {
  it('updates name successfully', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('New Name');
  });

  it('updates preferred display name and syncs the linked household person', async () => {
    const { cookie } = await createOwnerSession(app, { name: 'Christopher Example' });
    const update = await request(app)
      .put('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'Hus' });

    expect(update.status).toBe(200);
    expect(update.body.user.displayName).toBe('Hus');

    const household = await request(app).get('/api/household').set('Cookie', cookie);
    const linked = household.body.people.find(p => String(p.userId) === String(update.body.user._id));
    expect(linked).toBeDefined();
    expect(linked.displayName).toBe('Hus');
  });

  it('allows clearing explicit display name and falls back to first name', async () => {
    const { cookie } = await createOwnerSession(app, { name: 'Christopher Example' });
    await request(app).put('/api/auth/profile').set('Cookie', cookie).send({ displayName: 'Hus' });
    const res = await request(app).put('/api/auth/profile').set('Cookie', cookie).send({ displayName: '' });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Christopher');
  });

  it('returns 400 when no profile field is provided', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/auth/profile').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });

  it('returns 409 when new email is already taken', async () => {
    await createOwnerSession(app, { email: 'taken@test.com' });
    const { cookie } = await createOwnerSession(app, { email: 'owner2@test.com' });
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ email: 'taken@test.com' });
    expect(res.status).toBe(409);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await request(app).put('/api/auth/profile').send({ name: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/password', () => {
  it('changes password with correct currentPassword', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .put('/api/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'password123', newPassword: 'newpassword456' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 401 when currentPassword is wrong', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .put('/api/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'wrongpass', newPassword: 'newpassword456' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when newPassword is too short', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .put('/api/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'password123', newPassword: 'short' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when fields are missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .put('/api/auth/password')
      .set('Cookie', cookie)
      .send({ currentPassword: 'password123' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/auth/account', () => {
  it('keeps a household favorite when its creator deletes their member account', async () => {
    const { cookie: ownerCookie } = await createOwnerSession(app);
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const favorite = await request(app)
      .post('/api/meal-plan/favorites')
      .set('Cookie', memberCookie)
      .send({ name: 'Member soup', notes: 'broth, carrots' });
    expect(favorite.status).toBe(200);

    const deleted = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', memberCookie)
      .send({ password: 'password123' });
    expect(deleted.status).toBe(200);

    const preserved = await FavoriteMeal.findById(favorite.body._id).lean();
    expect(preserved).toBeTruthy();
    expect(preserved.createdBy).toBeUndefined();
  });

  it('returns 400 when owner tries to delete account before deleting household', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookie)
      .send({ password: 'password123' });
    expect(res.status).toBe(400);
  });

  it('returns 401 when password is wrong', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookie)
      .send({ password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when password field is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(400);
  });
});
