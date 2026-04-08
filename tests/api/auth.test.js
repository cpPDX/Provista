const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession } = require('../helpers/auth');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

describe('POST /api/auth/register', () => {
  it('returns 201 and sets cookie when creating household', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email: 'alice@test.com', password: 'password123', action: 'create', householdName: 'Alices House' });
    expect(res.status).toBe(201);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.body.user.role).toBe('owner');
    expect(res.body.user.householdId).toBeTruthy();
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
      .send({ name: 'Bob', email: 'bob@test.com', password: 'password123', action: 'join', inviteCode });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('member');
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
      .send({ name: 'Alice', email: 'alice@test.com', password: 'password123', action: 'create', householdName: 'H' });
  });

  it('returns 200 and sets cookie with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@test.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.body.user.email).toBe('alice@test.com');
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

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/auth/me', () => {
  it('returns user and household with valid cookie', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
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

  it('returns 400 when neither name nor email provided', async () => {
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
