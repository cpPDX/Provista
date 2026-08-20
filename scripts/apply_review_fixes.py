from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_exact(path, old, new):
    text = read(path)
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"Expected text not found in {path}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def replace_regex(path, pattern, replacement, flags=re.S | re.M):
    text = read(path)
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Expected regex match not found in {path}: {pattern[:100]!r}")
    write(path, new_text)


# 1) Stored XSS in buildCallout.
replace_regex(
    'public/js/ui.js',
    r"function buildCallout\(entries\) \{.*?\n\}\n\n// Calculate a \"nice\" axis ceiling",
    '''function buildCallout(entries) {
  if (!entries || entries.length < 2) return '';
  const sorted = [...entries].sort((a, b) => a.pricePerUnit - b.pricePerUnit);
  const best = sorted[0];
  const worst = sorted[1];
  const unit = best.item?.unit || best.itemId?.unit || 'unit';
  const safeUnit = escapeHtml(unit);
  const bestStore = escapeHtml(best.store?.name || best.storeId?.name || 'Unknown store');
  const worstStore = escapeHtml(worst.store?.name || worst.storeId?.name || 'Unknown store');
  return `<div class="callout-box">
    Best value: ${escapeHtml(best.quantity)}${safeUnit} @ ${formatCurrency(best.price)} (${escapeHtml(formatPPU(best.pricePerUnit, unit))}) at ${bestStore}
    vs ${escapeHtml(worst.quantity)}${safeUnit} @ ${formatCurrency(worst.price)} (${escapeHtml(formatPPU(worst.pricePerUnit, unit))}) at ${worstStore}
  </div>`;
}

// Calculate a "nice" axis ceiling'''
)

# 2) Legacy price API household scoping.
replace_exact(
    'routes/prices.js',
    "const PriceEntry = require('../models/PriceEntry');\nconst mongoose = require('mongoose');",
    "const PriceEntry = require('../models/PriceEntry');\nconst Item = require('../models/Item');\nconst Store = require('../models/Store');\nconst mongoose = require('mongoose');"
)
replace_exact(
    'routes/prices.js',
    '''function calcFinalPrice(regularPrice, salePrice, couponAmount) {
  const base = (salePrice != null && salePrice < regularPrice) ? salePrice : regularPrice;
  return base - (couponAmount ?? 0);
}
''',
    '''function calcFinalPrice(regularPrice, salePrice, couponAmount) {
  const base = (salePrice != null && salePrice < regularPrice) ? salePrice : regularPrice;
  return base - (couponAmount ?? 0);
}

async function validateHouseholdReferences(itemId, storeId, householdId) {
  if (!mongoose.isValidObjectId(itemId) || !mongoose.isValidObjectId(storeId)) {
    return { item: null, store: null };
  }
  const [item, store] = await Promise.all([
    Item.findOne({ _id: itemId, householdId }).select('_id').lean(),
    Store.findOne({ _id: storeId, householdId }).select('_id').lean()
  ]);
  return { item, store };
}
'''
)
replace_exact(
    'routes/prices.js',
    '''    const existing = await PriceEntry.findOne({ _id: req.params.id, householdId: req.user.householdId });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const update = {''',
    '''    const existing = await PriceEntry.findOne({ _id: req.params.id, householdId: req.user.householdId });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const effectiveStoreId = req.body.storeId ?? existing.storeId;
    const refs = await validateHouseholdReferences(existing.itemId, effectiveStoreId, req.user.householdId);
    if (!refs.item) return res.status(404).json({ error: 'Item not found in this household' });
    if (!refs.store) return res.status(404).json({ error: 'Store not found in this household' });

    const update = {'''
)
replace_exact(
    'routes/prices.js',
    '''    if (!req.body.itemId) return res.status(400).json({ error: 'itemId is required' });
    if (!req.body.storeId) return res.status(400).json({ error: 'storeId is required' });
    if (regularPrice === undefined || regularPrice === null) return res.status(400).json({ error: 'regularPrice is required' });
    const rp = parseFloat(regularPrice);''',
    '''    if (!req.body.itemId) return res.status(400).json({ error: 'itemId is required' });
    if (!req.body.storeId) return res.status(400).json({ error: 'storeId is required' });
    if (regularPrice === undefined || regularPrice === null) return res.status(400).json({ error: 'regularPrice is required' });

    const refs = await validateHouseholdReferences(req.body.itemId, req.body.storeId, req.user.householdId);
    if (!refs.item) return res.status(404).json({ error: 'Item not found in this household' });
    if (!refs.store) return res.status(404).json({ error: 'Store not found in this household' });

    const rp = parseFloat(regularPrice);'''
)

# 3/4) Historical meal audiences + non-empty selected audience.
replace_regex(
    'routes/mealPlan.js',
    r"async function validateAudienceScope\(days, householdId\) \{.*?\n\}\n\n// GET /api/meal-plan",
    '''function collectAudienceIds(days) {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.flatMap(day =>
    (Array.isArray(day?.meals) ? day.meals : []).flatMap(meal =>
      Array.isArray(meal?.personIds) ? meal.personIds.map(String) : []
    )
  ))];
}

async function validateAudience(days, householdId) {
  if (!Array.isArray(days)) return null;

  for (const day of days) {
    for (const meal of (Array.isArray(day?.meals) ? day.meals : [])) {
      const ids = Array.isArray(meal?.personIds) ? meal.personIds.filter(Boolean).map(String) : [];
      const legacyName = String(meal?.personName || '').trim();
      if (meal?.forEveryone === false && ids.length === 0 && !legacyName) {
        return 'A meal for selected people must include at least one person';
      }
    }
  }

  const ids = collectAudienceIds(days);
  if (!ids.length) return null;
  if (ids.some(id => !mongoose.isValidObjectId(id))) {
    return 'Meal audience contains an invalid household person';
  }

  const count = await HouseholdPerson.countDocuments({
    _id: { $in: ids },
    householdId
  });
  return count === ids.length ? null : 'Meal audience contains a person outside this household';
}

// GET /api/meal-plan'''
)
replace_exact(
    'routes/mealPlan.js',
    '''    const result = plan.toObject();
    result.people = people;
    res.json(result);''',
    '''    const result = plan.toObject();
    const activeIds = new Set(people.map(person => String(person._id)));
    const referencedIds = collectAudienceIds(result.days)
      .filter(id => mongoose.isValidObjectId(id) && !activeIds.has(id));
    const historicalPeople = referencedIds.length
      ? await HouseholdPerson.find({ _id: { $in: referencedIds }, householdId: req.user.householdId }).lean()
      : [];
    result.people = [
      ...people,
      ...historicalPeople.map(person => ({ ...person, historical: person.active === false }))
    ];
    res.json(result);'''
)
replace_exact(
    'routes/mealPlan.js',
    '''    if (!(await validateAudienceScope(days, req.user.householdId))) {
      return res.status(400).json({ error: 'Meal audience contains a person outside this household' });
    }
''',
    '''    const audienceError = await validateAudience(days, req.user.householdId);
    if (audienceError) return res.status(400).json({ error: audienceError });
'''
)
replace_exact(
    'public/js/mealPlan.js',
    '''  btn.addEventListener('click', () => {
    const row = buildMealRow(mealType, { mealType, forEveryone: false, personIds: [], name: '', notes: '' }, true);
    contentEl.insertBefore(row, btn);
    row.querySelector('.meal-name-input')?.focus();
    scheduleSave();
  });''',
    '''  btn.addEventListener('click', () => {
    if (!mealPlanState.people.length) {
      if (typeof showToast === 'function') showToast('Add a household person before creating a separate meal');
      return;
    }
    const firstPersonId = String(mealPlanState.people[0]._id);
    const row = buildMealRow(mealType, {
      mealType,
      forEveryone: false,
      personIds: [firstPersonId],
      name: '',
      notes: ''
    }, true);
    contentEl.insertBefore(row, btn);
    row.querySelector('.meal-name-input')?.focus();
    scheduleSave();
  });'''
)

# 5) Server-side CSV same-day replacement.
replace_regex(
    'public/js/csvImportUnified.js',
    r"    // Existing-price detection remains best-effort\..*?    \} catch \(_\) \{\}\n\n",
    '''    // Same-item/store/day replacement is resolved server-side so imports do not
    // depend on the 100-row /api/prices listing.

'''
)
replace_exact(
    'public/js/csvImportUnified.js',
    '''        const payload = {
          regularPrice: row._finalPrice,
          quantity: row._quantity,
          date: rowDate.toISOString(),
          source: 'csv'
        };''',
    '''        const payload = {
          regularPrice: row._finalPrice,
          quantity: row._quantity,
          date: rowDate.toISOString(),
          source: 'csv',
          replaceSameDay: canReplace
        };'''
)
replace_regex(
    'public/js/csvImportUnified.js',
    r"        if \(item && store && canReplace\) \{.*?        \}\n\n",
    ''
)
replace_regex(
    'public/js/csvImportUnified.js',
    r"        if \(result\.entry\?\._id && savedItem\?\._id && savedStore\?\._id\) \{.*?        \}\n\n",
    ''
)
replace_exact(
    'routes/grocery.js',
    '''    const quantity = parsePositive(req.body.quantity, 'quantity', 1);
    const source = ['manual', 'csv'].includes(req.body.source) ? req.body.source : 'manual';

    let replacement = null;''',
    '''    const quantity = parsePositive(req.body.quantity, 'quantity', 1);
    const source = ['manual', 'csv'].includes(req.body.source) ? req.body.source : 'manual';
    const entryDate = req.body.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(entryDate.getTime())) fail(400, 'date must be a valid date');

    let replacement = null;'''
)
replace_exact(
    'routes/grocery.js',
    '''    if (replacement &&
        (String(replacement.itemId) !== String(item._id) || String(replacement.storeId) !== String(store._id))) {
      fail(400, 'Replacement price entry must use the same item and store');
    }

    const finalPrice = calcFinalPrice(regularPrice, salePrice, couponAmount);''',
    '''    if (!replacement && req.body.replaceSameDay) {
      if (!isAdmin) fail(403, 'Admin or owner role required to replace an existing price entry');
      if (source !== 'csv') fail(400, 'replaceSameDay is only supported for CSV imports');

      const dayStart = new Date(Date.UTC(
        entryDate.getUTCFullYear(), entryDate.getUTCMonth(), entryDate.getUTCDate()
      ));
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      replacement = await PriceEntry.findOne({
        householdId,
        itemId: item._id,
        storeId: store._id,
        status: 'approved',
        date: { $gte: dayStart, $lt: dayEnd }
      }).sort({ createdAt: -1 });
    }

    if (replacement &&
        (String(replacement.itemId) !== String(item._id) || String(replacement.storeId) !== String(store._id))) {
      fail(400, 'Replacement price entry must use the same item and store');
    }

    const finalPrice = calcFinalPrice(regularPrice, salePrice, couponAmount);'''
)
replace_exact('routes/grocery.js', '      date: req.body.date || new Date(),', '      date: entryDate,')

# 6) Local purchase date.
replace_exact(
    'public/js/groceryEntry.js',
    '''(function initGroceryEntry() {
  function categoryOptions() {''',
    '''(function initGroceryEntry() {
  function localDateValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function categoryOptions() {'''
)
replace_exact(
    'public/js/groceryEntry.js',
    'value="${new Date().toISOString().slice(0, 10)}" required',
    'value="${localDateValue()}" required'
)

# 7) Rate limiter regression coverage and accurate comment.
replace_exact(
    'middleware/security.js',
    '''    // Jest/Supertest intentionally sends many requests from one synthetic IP.
    // Rate limiting is integration-tested separately from the deterministic API suite.
    if (process.env.NODE_ENV === 'test') return next();''',
    '''    // Jest/Supertest intentionally sends many requests from one synthetic IP.
    // The deterministic API routes bypass limiting in test mode; security.test.js
    // invokes this middleware under production mode to verify the limiter itself.
    if (process.env.NODE_ENV === 'test') return next();'''
)
Path('tests/api/security.test.js').write_text('''const { createRateLimiter, securityHeaders } = require('../../middleware/security');

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
''')

# Price API regression tests.
replace_exact(
    'tests/api/prices.test.js',
    '''  it('calculates pricePerUnit as finalPrice / quantity', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const res = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId, { regularPrice: 4.00, quantity: 2 }));
    expect(res.status).toBe(201);
    expect(res.body.pricePerUnit).toBeCloseTo(2.0);
  });
});''',
    '''  it('calculates pricePerUnit as finalPrice / quantity', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const res = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId, { regularPrice: 4.00, quantity: 2 }));
    expect(res.status).toBe(201);
    expect(res.body.pricePerUnit).toBeCloseTo(2.0);
  });

  it('rejects item or store IDs from another household', async () => {
    const first = await createOwnerSession(app, { email: 'prices-first@test.com', householdName: 'First' });
    const second = await createOwnerSession(app, { email: 'prices-second@test.com', householdName: 'Second' });
    const foreignItem = await request(app).post('/api/items').set('Cookie', second.cookie)
      .send({ name: 'Foreign', category: 'Pantry', unit: 'each' });
    const localStore = await request(app).post('/api/stores').set('Cookie', first.cookie)
      .send({ name: 'Local' });

    const res = await request(app).post('/api/prices').set('Cookie', first.cookie)
      .send(pricePayload(foreignItem.body._id, localStore.body._id));
    expect(res.status).toBe(404);
  });
});'''
)
replace_exact(
    'tests/api/prices.test.js',
    '''  it('returns 403 for member', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const pending = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId));
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .put(`/api/prices/${pending.body._id}/approve`)
      .set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});''',
    '''  it('returns 403 for member', async () => {
    const { ownerCookie, itemId, storeId } = await setupFixtures(app);
    const pending = await request(app).post('/api/prices').set('Cookie', ownerCookie)
      .send(pricePayload(itemId, storeId));
    const code = await getInviteCode(app, ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const res = await request(app)
      .put(`/api/prices/${pending.body._id}/approve`)
      .set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });

  it('rejects changing a pending entry to a store from another household', async () => {
    const local = await setupFixtures(app);
    const code = await getInviteCode(app, local.ownerCookie);
    const { cookie: memberCookie } = await createMemberSession(app, code);
    const pending = await request(app).post('/api/prices').set('Cookie', memberCookie)
      .send(pricePayload(local.itemId, local.storeId));

    const foreign = await createOwnerSession(app, { email: 'prices-foreign@test.com', householdName: 'Foreign' });
    const foreignStore = await request(app).post('/api/stores').set('Cookie', foreign.cookie)
      .send({ name: 'Foreign Store' });

    const res = await request(app)
      .put(`/api/prices/${pending.body._id}/approve`)
      .set('Cookie', local.ownerCookie)
      .send({ storeId: foreignStore.body._id });
    expect(res.status).toBe(404);

    const stillPending = await request(app).get('/api/prices/pending').set('Cookie', local.ownerCookie);
    expect(stillPending.body.some(entry => entry._id === pending.body._id)).toBe(true);
  });
});'''
)

# Meal-plan regression tests.
replace_exact(
    'tests/api/mealPlan.test.js',
    '''  it('returns 400 when weekStart is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/meal-plan').set('Cookie', cookie);
    expect(res.status).toBe(400);
  });''',
    '''  it('returns inactive people that are still referenced by historical meal audiences', async () => {
    const { cookie } = await createOwnerSession(app);
    const person = await request(app).post('/api/household/people').set('Cookie', cookie)
      .send({ displayName: 'Former Guest' });
    expect(person.status).toBe(201);

    const days = [{
      date: `${WEEK_START}T00:00:00.000Z`,
      specialCollapsed: true,
      meals: [{ mealType: 'dinner', name: 'Old dinner', forEveryone: false, personIds: [person.body._id] }]
    }];
    const save = await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days });
    expect(save.status).toBe(200);

    const removed = await request(app).delete(`/api/household/people/${person.body._id}`).set('Cookie', cookie);
    expect(removed.status).toBe(200);

    const loaded = await request(app).get(`/api/meal-plan?weekStart=${WEEK_START}`).set('Cookie', cookie);
    expect(loaded.status).toBe(200);
    const historical = loaded.body.people.find(p => p._id === person.body._id);
    expect(historical).toBeTruthy();
    expect(historical.active).toBe(false);
    expect(loaded.body.days[0].meals[0].personIds.map(String)).toContain(String(person.body._id));
  });

  it('returns 400 when weekStart is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).get('/api/meal-plan').set('Cookie', cookie);
    expect(res.status).toBe(400);
  });'''
)
replace_exact(
    'tests/api/mealPlan.test.js',
    '''  it('returns 400 when weekStart is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie).send({ days: [] });
    expect(res.status).toBe(400);
  });
});''',
    '''  it('rejects a selected-people meal with nobody selected', async () => {
    const { cookie } = await createOwnerSession(app);
    const days = [{
      date: `${WEEK_START}T00:00:00.000Z`,
      specialCollapsed: true,
      meals: [{ mealType: 'dinner', name: 'Nobody dinner', forEveryone: false, personIds: [], personName: '' }]
    }];
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one person/i);
  });

  it('preserves unmatched legacy personName while migration is in progress', async () => {
    const { cookie } = await createOwnerSession(app);
    const days = [{
      date: `${WEEK_START}T00:00:00.000Z`,
      specialCollapsed: true,
      meals: [{ mealType: 'dinner', name: 'Legacy dinner', forEveryone: false, personIds: [], personName: 'Legacy Person' }]
    }];
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie)
      .send({ weekStart: WEEK_START, days });
    expect(res.status).toBe(200);
    expect(res.body.days[0].meals[0].personName).toBe('Legacy Person');
  });

  it('returns 400 when weekStart is missing', async () => {
    const { cookie } = await createOwnerSession(app);
    const res = await request(app).put('/api/meal-plan').set('Cookie', cookie).send({ days: [] });
    expect(res.status).toBe(400);
  });
});'''
)

# CSV history regression test.
replace_exact(
    'tests/api/grocery.test.js',
    "const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');",
    "const { createOwnerSession, createMemberSession, getInviteCode } = require('../helpers/auth');\nconst PriceEntry = require('../../models/PriceEntry');"
)
replace_exact(
    'tests/api/grocery.test.js',
    "  it('rejects replacement when item or store does not match and preserves the original', async () => {",
    '''  it('replaces a same-day CSV price even when the old entry is outside the newest 100 prices', async () => {
    const { cookie, user } = await createOwnerSession(app);
    const [item, store] = await Promise.all([
      request(app).post('/api/items').set('Cookie', cookie)
        .send({ name: 'Deep History Coffee', category: 'Pantry', unit: 'bag' }),
      request(app).post('/api/stores').set('Cookie', cookie)
        .send({ name: 'History Store' })
    ]);

    const common = {
      householdId: user.householdId,
      itemId: item.body._id,
      storeId: store.body._id,
      submittedBy: user._id,
      regularPrice: 5,
      finalPrice: 5,
      quantity: 1,
      pricePerUnit: 5,
      source: 'csv',
      status: 'approved',
      reviewedBy: user._id,
      reviewedAt: new Date()
    };
    const docs = [{ ...common, date: new Date('2025-01-01T12:00:00.000Z') }];
    for (let i = 0; i < 100; i++) {
      docs.push({ ...common, date: new Date(Date.UTC(2025, 0, 2 + i)) });
    }
    await PriceEntry.insertMany(docs);

    const listed = await request(app).get('/api/prices').set('Cookie', cookie);
    expect(listed.body).toHaveLength(100);
    expect(listed.body.some(entry => String(entry.date).startsWith('2025-01-01'))).toBe(false);

    const replacement = await request(app).post('/api/grocery/log').set('Cookie', cookie)
      .send({
        itemId: item.body._id,
        storeId: store.body._id,
        regularPrice: 4.25,
        date: '2025-01-01T12:00:00.000Z',
        source: 'csv',
        replaceSameDay: true
      });
    expect(replacement.status).toBe(201);
    expect(replacement.body.replacedPriceEntryId).toBeTruthy();

    const sameDay = await PriceEntry.find({
      householdId: user.householdId,
      itemId: item.body._id,
      storeId: store.body._id,
      date: { $gte: new Date('2025-01-01T00:00:00.000Z'), $lt: new Date('2025-01-02T00:00:00.000Z') }
    });
    expect(sameDay).toHaveLength(1);
    expect(sameDay[0].finalPrice).toBe(4.25);
  });

  it('rejects replacement when item or store does not match and preserves the original', async () => {'''
)

# Browser regression coverage.
replace_exact(
    'tests/e2e/prices.spec.js',
    "const { loginAsNewUser } = require('./helpers/login');\n",
    "const { loginAsNewUser } = require('./helpers/login');\n\ntest.use({ timezoneId: 'America/Los_Angeles' });\n"
)
replace_exact(
    'tests/e2e/prices.spec.js',
    "  test('catalog Add Item starts the same flow in new-item mode', async ({ page }) => {",
    '''  test('new grocery date defaults to the browser local calendar date', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-08-20T02:30:00.000Z') });
    await page.click('#btn-add-price');
    await expect(page.locator('#price-date')).toHaveValue('2026-08-19');
  });

  test('best-value callout escapes untrusted store names', async ({ page }) => {
    const html = await page.evaluate(() => buildCallout([
      { quantity: 1, price: 2, pricePerUnit: 2, item: { unit: 'each' }, store: { name: '<img src=x onerror=alert(1)>' } },
      { quantity: 1, price: 3, pricePerUnit: 3, item: { unit: 'each' }, store: { name: 'Safe Store' } }
    ]));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  test('catalog Add Item starts the same flow in new-item mode', async ({ page }) => {'''
)
replace_exact(
    'tests/e2e/mealPlan.spec.js',
    "  test('prev/next week nav changes the week label', async ({ page }) => {",
    '''  test('a separate meal starts with a real household audience', async ({ page }) => {
    const firstSection = page.locator('.meal-day').first().locator('.meal-type-section').first();
    await firstSection.locator('.meal-add-row').click();
    await expect(firstSection.locator('.meal-row')).toHaveCount(2);
    const audience = firstSection.locator('.meal-row').nth(1).locator('.meal-audience-toggle');
    await expect(audience).not.toHaveText('Choose people');
    await expect(audience).not.toHaveText('Everyone');
  });

  test('prev/next week nav changes the week label', async ({ page }) => {'''
)

print('Review fixes applied successfully.')
