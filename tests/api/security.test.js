const { createRateLimiter, securityHeaders } = require('../../middleware/security');

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
  it('enforces rate limits when running in production mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const limiter = createRateLimiter({ windowMs: 60_000, max: 2, keyPrefix: 'test' });
      const req = { ip: '203.0.113.10', socket: { remoteAddress: '203.0.113.10' } };
      const next = jest.fn();

      limiter(req, makeResponse(), next);
      limiter(req, makeResponse(), next);
      const blocked = makeResponse();
      limiter(req, blocked, next);

      expect(next).toHaveBeenCalledTimes(2);
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['Retry-After']).toBeDefined();
      expect(blocked.body.error).toMatch(/too many requests/i);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
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
