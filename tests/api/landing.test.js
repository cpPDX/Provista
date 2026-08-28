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

  it('continues a returning user with a valid session into the app', async () => {
    const token = jwt.sign({ userId: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const res = await request(app).get('/').set('Cookie', `token=${token}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="app">');
    expect(res.text).not.toContain('Grocery planning for real households');
  });
});
