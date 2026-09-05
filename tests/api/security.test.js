const express = require('express');
const request = require('supertest');
const { rateLimit } = require('express-rate-limit');
const { securityHeaders } = require('../../middleware/security');

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;

function restoreEnvironment() {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;

  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
}

function loadServerForNodeEnv(nodeEnv) {
  jest.resetModules();
  process.env.NODE_ENV = nodeEnv;
  process.env.JWT_SECRET = 'proxy-trust-test-secret';
  return require('../../server');
}

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
  afterEach(() => {
    restoreEnvironment();
    jest.resetModules();
  });

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

  it('trusts exactly one Railway proxy hop in production so forwarded clients get separate rate-limit buckets', async () => {
    const productionApp = loadServerForNodeEnv('production');
    expect(productionApp.get('trust proxy')).toBe(1);

    const limitedApp = express();
    limitedApp.set('trust proxy', productionApp.get('trust proxy'));
    limitedApp.use(rateLimit({
      windowMs: 60_000,
      limit: 1,
      standardHeaders: 'draft-6',
      legacyHeaders: false,
      message: { error: 'Too many requests. Please try again later.' }
    }));
    limitedApp.get('/', (req, res) => res.json({ ip: req.ip }));

    const firstClient = await request(limitedApp)
      .get('/')
      .set('X-Forwarded-For', '203.0.113.10')
      .expect(200);
    expect(firstClient.body.ip).toBe('203.0.113.10');

    await request(limitedApp)
      .get('/')
      .set('X-Forwarded-For', '203.0.113.10')
      .expect(429);

    const secondClient = await request(limitedApp)
      .get('/')
      .set('X-Forwarded-For', '203.0.113.11')
      .expect(200);
    expect(secondClient.body.ip).toBe('203.0.113.11');
  });

  it('keeps proxy trust disabled in test mode', () => {
    const testApp = loadServerForNodeEnv('test');
    expect(testApp.get('trust proxy')).toBe(false);
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
