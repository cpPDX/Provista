const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../server');

describe('public landing page', () => {
  it('explains Provista before asking a signed-out visitor to create an account', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Plan meals.');
    expect(res.text).toContain('Grocery planning for real households');
    expect(res.text).toContain('data-open-auth="signup"');
    expect(res.text).toContain('/screenshots/meal-plan.jpg');
    expect(res.text).toContain('/screenshots/shopping-list.jpg');
    expect(res.text).toContain('/screenshots/pantry.jpg');
    expect(res.text).toContain('Bring meals, shopping, pantry, and spending');
  });

  it('uses non-branded grocery-planning metadata and structured data', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>Provista — Shared Grocery List, Meal Planner & Pantry Tracker</title>');
    expect(res.text).toContain('A shared grocery list and meal planning app for households.');
    expect(res.text).toContain('application/ld+json');
    expect(res.text).toContain('SoftwareApplication');
    expect(res.text).toContain('Shared grocery lists');
    expect(res.text).toContain('Grocery list organization by store section');
    expect(res.text).toContain('rel="canonical"');
  });

  it('publishes crawl guidance and a sitemap for the public landing page', async () => {
    const robots = await request(app).get('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.text).toContain('User-agent: *');
    expect(robots.text).toContain('Allow: /');
    expect(robots.text).toContain('Disallow: /app');
    expect(robots.text).toContain('Disallow: /api/');
    expect(robots.text).toMatch(/Sitemap: http:\/\/127\.0\.0\.1(?::\d+)?\/sitemap\.xml/);

    const sitemap = await request(app).get('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.type).toMatch(/xml/);
    expect(sitemap.text).toMatch(/<loc>http:\/\/127\.0\.0\.1(?::\d+)?\/<\/loc>/);
  });

  it('continues a returning user with a valid session into the app', async () => {
    const token = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const res = await request(app).get('/').set('Cookie', `token=${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="app">');
    expect(res.text).not.toContain('Grocery planning for real households');
  });
});
