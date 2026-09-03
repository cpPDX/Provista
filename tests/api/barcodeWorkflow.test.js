const { EventEmitter } = require('events');
const https = require('https');
const request = require('supertest');
const app = require('../../server');
const db = require('../helpers/db');
const { createOwnerSession } = require('../helpers/auth');
const Item = require('../../models/Item');

beforeAll(db.connect);
beforeEach(db.clearDB);
afterAll(db.disconnect);
afterEach(() => jest.restoreAllMocks());

function mockOpenFoodFacts(payload, statusCode = 200) {
  return jest.spyOn(https, 'get').mockImplementation((_url, _options, callback) => {
    const req = new EventEmitter();
    req.destroy = jest.fn();
    process.nextTick(() => {
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.resume = jest.fn();
      callback(res);
      if (statusCode === 200) {
        process.nextTick(() => {
          res.emit('data', JSON.stringify(payload));
          res.emit('end');
        });
      }
    });
    return req;
  });
}

describe('barcode product resolution', () => {
  it('uses a known household UPC immediately without contacting Open Food Facts', async () => {
    const { cookie } = await createOwnerSession(app);
    const product = await request(app).post('/api/items').set('Cookie', cookie).send({
      name: 'Household Corrected Milk',
      brand: 'Our Brand',
      category: 'Dairy',
      unit: 'carton',
      size: 1,
      upc: '012345678905',
      upcSource: 'manual'
    });
    expect(product.status).toBe(201);
    const off = jest.spyOn(https, 'get');

    const result = await request(app).get('/api/barcode/012345678905').set('Cookie', cookie);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      found: true,
      source: 'local',
      confidence: 'full',
      autoAccept: true,
      missingFields: [],
      item: {
        _id: product.body._id,
        name: 'Household Corrected Milk',
        brand: 'Our Brand',
        category: 'Dairy',
        unit: 'carton',
        size: 1,
        upc: '012345678905'
      }
    });
    expect(off).not.toHaveBeenCalled();
  });

  it('fills safe blanks on a known UPC without overwriting household-corrected identity', async () => {
    const { cookie } = await createOwnerSession(app);
    const product = await request(app).post('/api/items').set('Cookie', cookie).send({
      name: 'Household Oat Drink',
      category: 'Dairy',
      unit: 'carton',
      isOrganic: false,
      upc: '036000291452',
      upcSource: 'manual'
    });
    expect(product.status).toBe(201);

    mockOpenFoodFacts({
      status: 1,
      product: {
        product_name: 'Public Conflicting Name',
        brands: 'Public Brand',
        categories_tags: ['en:breakfast-cereals'],
        quantity: '32 fl oz',
        labels_tags: ['en:organic']
      }
    });

    const enriched = await request(app)
      .post('/api/barcode/036000291452/enrich-local')
      .set('Cookie', cookie)
      .send({});

    expect(enriched.status).toBe(200);
    expect(enriched.body.filledFields.sort()).toEqual(['brand', 'size']);
    expect(enriched.body.item).toMatchObject({
      _id: product.body._id,
      name: 'Household Oat Drink',
      brand: 'Public Brand',
      category: 'Dairy',
      unit: 'carton',
      size: 32,
      isOrganic: false
    });

    const stored = await Item.findById(product.body._id).lean();
    expect(stored).toMatchObject({
      name: 'Household Oat Drink',
      brand: 'Public Brand',
      category: 'Dairy',
      unit: 'carton',
      size: 32,
      isOrganic: false
    });
  });

  it('returns complete trustworthy metadata for a new UPC', async () => {
    const { cookie } = await createOwnerSession(app);
    mockOpenFoodFacts({
      status: 1,
      product: {
        product_name_en: 'Public Granola',
        brands: 'Example Brand, Parent Company',
        categories_tags: ['en:breakfast-cereals'],
        quantity: '12 oz',
        labels_tags: ['en:organic']
      }
    });

    const result = await request(app).get('/api/barcode/4006381333931').set('Cookie', cookie);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      found: true,
      source: 'openFoodFacts',
      confidence: 'full',
      autoAccept: false,
      missingFields: [],
      item: {
        upc: '4006381333931',
        name: 'Public Granola',
        brand: 'Example Brand',
        unit: 'oz',
        size: 12,
        isOrganic: true
      }
    });
  });

  it('identifies only the fields a parent must supply for partial public metadata', async () => {
    const { cookie } = await createOwnerSession(app);
    mockOpenFoodFacts({
      status: 1,
      product: {
        product_name: 'Partial Public Product',
        brands: 'Example Brand',
        categories_tags: ['en:dairy-products'],
        quantity: '',
        labels_tags: []
      }
    });

    const result = await request(app).get('/api/barcode/9780201379624').set('Cookie', cookie);

    expect(result.status).toBe(200);
    expect(result.body.found).toBe(true);
    expect(result.body.confidence).toBe('partial');
    expect(result.body.missingFields).toEqual(['unit']);
    expect(result.body.item).toMatchObject({
      name: 'Partial Public Product',
      brand: 'Example Brand',
      upc: '9780201379624'
    });
  });

  it('returns a normal missing-details state when no public product exists', async () => {
    const { cookie } = await createOwnerSession(app);
    mockOpenFoodFacts({ status: 0, product: null });

    const result = await request(app).get('/api/barcode/123456789012').set('Cookie', cookie);

    expect(result.status).toBe(200);
    expect(result.body).toEqual(expect.objectContaining({
      found: false,
      source: null,
      confidence: null,
      autoAccept: false,
      missingFields: ['name', 'category', 'unit'],
      item: { upc: '123456789012' }
    }));
  });
});
