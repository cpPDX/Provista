const {
  fetchExternalPrices,
  getPriceProvider,
  registerPriceProvider,
  unregisterPriceProvider
} = require('../../services/externalPricing/providerRegistry');
const openPricesProvider = require('../../services/externalPricing/openPricesProvider');

const realFetch = global.fetch;

afterEach(() => {
  unregisterPriceProvider('test-provider');
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('external price provider registry', () => {
  it('registers providers behind a normalized contract', async () => {
    const fetchPrices = jest.fn().mockResolvedValue([{ price: 1.23 }]);
    registerPriceProvider({ id: 'Test-Provider', displayName: 'Test Provider', fetchPrices });

    expect(getPriceProvider('test-provider').displayName).toBe('Test Provider');
    await expect(fetchExternalPrices('TEST-PROVIDER', { upc: '123' }))
      .resolves.toEqual([{ price: 1.23 }]);
    expect(fetchPrices).toHaveBeenCalledWith({ upc: '123' });
  });

  it('rejects providers that do not implement fetchPrices', () => {
    expect(() => registerPriceProvider({ id: 'test-provider' }))
      .toThrow('must implement fetchPrices');
  });
});

describe('Open Prices store resolution', () => {
  it('can use an existing free-form Provista location without guessing on name alone', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{
          id: 42,
          osm_name: 'Example Market',
          osm_brand: 'Example Market',
          osm_display_name: 'Example Market, 123 Main St, Portland, Oregon, United States',
          osm_address_city: 'Portland',
          osm_address_country_code: 'us',
          price_count: 12
        }]
      })
    });

    const match = await openPricesProvider.resolveLocation({
      name: 'Example Market',
      location: 'Portland',
      externalIds: new Map()
    });

    expect(match).toMatchObject({ id: '42', source: 'resolved' });
    expect(match.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('rejects ambiguous chain locations when there is no useful location hint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          { id: 1, osm_name: 'Chain Market', osm_brand: 'Chain Market', osm_display_name: 'Chain Market, Portland', osm_address_country_code: 'us' },
          { id: 2, osm_name: 'Chain Market', osm_brand: 'Chain Market', osm_display_name: 'Chain Market, Beaverton', osm_address_country_code: 'us' }
        ]
      })
    });

    await expect(openPricesProvider.resolveLocation({
      name: 'Chain Market',
      location: '',
      externalIds: new Map()
    })).resolves.toBeNull();
  });
});
