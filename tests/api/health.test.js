const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);

describe('health endpoints', () => {
  it('returns process liveness without authentication and baseline security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toContain('camera=(self)');
  });

  it('returns readiness when MongoDB is connected', async () => {
    const res = await request(app).get('/api/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.database).toBe('connected');
  });
});
