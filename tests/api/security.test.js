const express = require('express');
const request = require('supertest');
const { rateLimit } = require('express-rate-limit');
const { securityHeaders } = require('../../middleware/security');

function makeResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

describe('security middleware', () => {
  it('enforces the standard rate-limit response contract', async () => {
    const limitedApp = express();
    limitedApp.use(rateLimit({
      windowMs: 60_000,
      limit: 2,
      standardHeaders: 'draft-6',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please try again later.' }
    }));
    limitedApp.get('/', (req, res) => res.json({ ok: true }));

    await request(limitedApp).get('/').expect(200);
    await request(limitedApp).get('/').expect(200);
    const blocked = await request(limitedApp).get('/').expect(429);

    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.headers['ratelimit-limit']).toBe('2');
    expect(blocked.body.error).toMatch(/too many requests/i);
  });

  it('sets baseline browser security headers', () => {
    const req = {};
    const res = makeResponse();
    const next = jest.fn();
    securityHeaders(req, res, next);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['X-Frame-Options']).toBe('DENY');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
