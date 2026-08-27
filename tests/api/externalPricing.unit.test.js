const {
  fetchExternalPrices,
  getPriceProvider,
  registerPriceProvider,
  unregisterPriceProvider
} = require('../../services/externalPricing/providerRegistry');

afterEach(() => unregisterPriceProvider('test-provider'));

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
