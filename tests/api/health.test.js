const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

describe('health endpoints', () => {
  it('returns process liveness without authentication', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns readiness when MongoDB is connected', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.database).toBe('connected');
  });
});
