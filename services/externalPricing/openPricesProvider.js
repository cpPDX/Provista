const OPEN_PRICES_BASE_URL = process.env.OPEN_PRICES_BASE_URL || 'https://prices.openfoodfacts.org';
const REQUEST_TIMEOUT_MS = Number(process.env.OPEN_PRICES_TIMEOUT_MS) || 5000;
const USER_AGENT = process.env.OPEN_PRICES_USER_AGENT || 'Provista/1.0 (https://github.com/cpPDX/Provista)';

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function getJson(path, params = {}) {
  const url = new URL(path, OPEN_PRICES_BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Open Prices returned HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function storeLocationHint(store) {
  return normalizeText([
    store.address?.street,
    store.address?.city,
    store.address?.state,
    store.address?.postalCode,
    store.location
  ].filter(Boolean).join(' '));
}

function scoreLocation(store, location) {
  const storeName = normalizeText(store.name);
  const locationName = normalizeText(location.osm_name);
  const locationBrand = normalizeText(location.osm_brand);
  const storeCity = normalizeText(store.address?.city);
  const locationCity = normalizeText(location.osm_address_city);
  const storePostal = normalizeText(store.address?.postalCode);
  const locationPostal = normalizeText(location.osm_address_postcode);
  const locationHint = storeLocationHint(store);
  const displayName = normalizeText(location.osm_display_name);

  let score = 0;
  const exactName = storeName && (locationName === storeName || locationBrand === storeName);
  const partialName = storeName && (
    locationName.includes(storeName) || storeName.includes(locationName) ||
    locationBrand.includes(storeName) || storeName.includes(locationBrand)
  );

  if (exactName) score += 60;
  else if (partialName) score += 40;
  else return 0;

  if (storePostal && locationPostal === storePostal) score += 35;
  if (storeCity && locationCity === storeCity) score += 25;
  if (locationHint && displayName.includes(locationHint)) score += 20;
  else if (store.location && displayName.includes(normalizeText(store.location))) score += 15;
  if (normalizeText(location.osm_address_country_code) === 'us') score += 5;

  return score;
}

function rankLocations(store, candidates) {
  return candidates
    .map(location => ({ location, score: scoreLocation(store, location) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function queryLocations(store, city) {
  const data = await getJson('/api/v1/locations', {
    osm_name__like: store.name,
    osm_address_city__like: city || undefined,
    price_count__gte: 1,
    size: 25
  });
  return Array.isArray(data?.items) ? data.items : [];
}

async function resolveLocation(store) {
  const cached = store.externalIds?.get?.('open-prices') || store.externalIds?.['open-prices'];
  if (cached) return { id: String(cached), confidence: 1, source: 'cached' };

  // Newer stores can supply a structured city. Older Provista stores only have
  // a free-form `location`, which may be a street, neighborhood, or city. Use
  // the structured city as a narrowing filter when available, then fall back
  // to a name-only search and conservative display-name scoring so existing
  // stores do not need a migration just to try Open Prices.
  const structuredCity = store.address?.city || '';
  let candidates = await queryLocations(store, structuredCity);
  let scored = rankLocations(store, candidates);

  if ((!scored.length || scored[0].score < 75) && (structuredCity || store.location)) {
    const broadCandidates = await queryLocations(store, '');
    const byId = new Map(candidates.map(location => [String(location.id), location]));
    broadCandidates.forEach(location => byId.set(String(location.id), location));
    candidates = [...byId.values()];
    scored = rankLocations(store, candidates);
  }

  if (!scored.length || scored[0].score < 75) return null;
  if (scored[1] && scored[1].score === scored[0].score) return null;

  return {
    id: String(scored[0].location.id),
    confidence: Math.min(0.99, scored[0].score / 100),
    source: 'resolved',
    location: scored[0].location
  };
}

function normalizeObservation(row, context, locationMatch) {
  const price = Number(row.price);
  if (!Number.isFinite(price) || price < 0) return null;

  const observedAt = row.date ? new Date(`${row.date}T12:00:00.000Z`) : new Date(row.created || Date.now());
  const regularPrice = row.price_without_discount === null || row.price_without_discount === undefined
    ? null
    : Number(row.price_without_discount);

  return {
    itemId: context.item._id,
    storeId: context.store._id,
    provider: 'open-prices',
    providerProductId: row.product_id ? String(row.product_id) : null,
    providerLocationId: row.location_id ? String(row.location_id) : String(locationMatch.id),
    price,
    regularPrice: Number.isFinite(regularPrice) ? regularPrice : null,
    salePrice: row.price_is_discounted ? price : null,
    pricePerUnit: null,
    currency: row.currency || 'USD',
    observedAt,
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    matchMethod: 'upc',
    confidence: Math.max(0.9, locationMatch.confidence || 0.9),
    sourceUrl: row.id ? `${OPEN_PRICES_BASE_URL}/api/v1/prices/${row.id}` : OPEN_PRICES_BASE_URL
  };
}

async function fetchPrices(context) {
  const { item, store, maxAgeDays = 30 } = context || {};
  if (!item?.upc || !store?._id) return [];

  const locationMatch = await resolveLocation(store);
  if (!locationMatch) return [];

  const earliest = new Date();
  earliest.setUTCDate(earliest.getUTCDate() - maxAgeDays);
  const dateGte = earliest.toISOString().slice(0, 10);

  const data = await getJson('/api/v1/prices', {
    product_code: item.upc,
    location_id: locationMatch.id,
    date__gte: dateGte,
    duplicate_of__isnull: true,
    order_by: '-date',
    size: 20
  });
  const rows = Array.isArray(data?.items) ? data.items : [];
  const observations = rows
    .map(row => normalizeObservation(row, context, locationMatch))
    .filter(Boolean)
    .sort((a, b) => b.observedAt - a.observedAt);

  return observations.slice(0, 1);
}

module.exports = {
  id: 'open-prices',
  displayName: 'Open Prices',
  fetchPrices,
  resolveLocation
};
