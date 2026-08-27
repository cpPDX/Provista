const providers = new Map();

function normalizeProviderId(providerId) {
  return String(providerId || '').trim().toLowerCase();
}

function validateProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new TypeError('Price provider must be an object');
  }
  const id = normalizeProviderId(provider.id);
  if (!id) throw new TypeError('Price provider id is required');
  if (typeof provider.fetchPrices !== 'function') {
    throw new TypeError(`Price provider ${id} must implement fetchPrices(context)`);
  }
  return id;
}

function registerPriceProvider(provider, { replace = false } = {}) {
  const id = validateProvider(provider);
  if (providers.has(id) && !replace) {
    throw new Error(`Price provider ${id} is already registered`);
  }
  providers.set(id, { ...provider, id });
  return providers.get(id);
}

function unregisterPriceProvider(providerId) {
  return providers.delete(normalizeProviderId(providerId));
}

function getPriceProvider(providerId) {
  return providers.get(normalizeProviderId(providerId)) || null;
}

function listPriceProviders() {
  return [...providers.values()];
}

async function fetchExternalPrices(providerId, context) {
  const provider = getPriceProvider(providerId);
  if (!provider) throw new Error(`Price provider ${normalizeProviderId(providerId)} is not registered`);

  const observations = await provider.fetchPrices(context);
  if (!Array.isArray(observations)) {
    throw new TypeError(`Price provider ${provider.id} must return an array of normalized observations`);
  }
  return observations;
}

module.exports = {
  fetchExternalPrices,
  getPriceProvider,
  listPriceProviders,
  registerPriceProvider,
  unregisterPriceProvider
};
