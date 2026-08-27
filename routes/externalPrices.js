const express = require('express');
const router = express.Router();
const Household = require('../models/Household');
const PriceObservation = require('../models/PriceObservation');
const ShoppingListItem = require('../models/ShoppingListItem');
const Store = require('../models/Store');
const { requireAuth } = require('../middleware/auth');
const {
  fetchExternalPrices,
  listPriceProviders,
  registerPriceProvider
} = require('../services/externalPricing/providerRegistry');
const openPricesProvider = require('../services/externalPricing/openPricesProvider');

const isProd = process.env.NODE_ENV === 'production';
const MAX_REFRESH_ITEMS = 25;
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

registerPriceProvider(openPricesProvider, { replace: true });

function serializeObservation(observation) {
  if (!observation) return null;
  return {
    _id: observation._id,
    itemId: observation.itemId,
    storeId: observation.storeId,
    provider: observation.provider,
    price: observation.price,
    regularPrice: observation.regularPrice,
    salePrice: observation.salePrice,
    currency: observation.currency,
    observedAt: observation.observedAt,
    fetchedAt: observation.fetchedAt,
    expiresAt: observation.expiresAt,
    confidence: observation.confidence,
    sourceUrl: observation.sourceUrl
  };
}

async function latestCachedObservation(householdId, itemId, storeId) {
  return PriceObservation.findOne({
    householdId,
    itemId,
    storeId,
    provider: 'open-prices',
    expiresAt: { $gt: new Date() }
  }).sort({ observedAt: -1, fetchedAt: -1 });
}

async function refreshOne({ householdId, item, store }) {
  const cached = await latestCachedObservation(householdId, item._id, store._id);
  if (cached) return { observation: cached, cached: true };

  const observations = await fetchExternalPrices('open-prices', {
    item,
    store,
    maxAgeDays: 30
  });
  if (!observations.length) return { observation: null, cached: false };

  const observation = await PriceObservation.create({
    householdId,
    ...observations[0]
  });

  const existingProviderId = store.externalIds?.get?.('open-prices') || store.externalIds?.['open-prices'];
  if (!existingProviderId && observation.providerLocationId && observation.confidence >= 0.9) {
    await Store.updateOne(
      { _id: store._id, householdId },
      { $set: { 'externalIds.open-prices': observation.providerLocationId } }
    );
  }

  return { observation, cached: false };
}

async function mapWithConcurrency(values, limit, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(values[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return results;
}

router.get('/providers', requireAuth, (req, res) => {
  res.json(listPriceProviders().map(provider => ({
    id: provider.id,
    displayName: provider.displayName || provider.id
  })));
});

// Refresh external observations for the current shopping list without blocking
// the core list endpoint. Only UPC-backed items at a reliably matched store are
// eligible, and cached results are reused for 12 hours.
router.post('/refresh-shopping-list', requireAuth, async (req, res) => {
  try {
    const householdId = req.user.householdId;
    const [household, listItems] = await Promise.all([
      Household.findById(householdId).select('settings.usualStoreId').lean(),
      ShoppingListItem.find({ householdId, checked: false })
        .populate('itemId', 'name brand category unit size upc')
        .populate('storeId')
        .sort({ addedAt: -1 })
        .limit(MAX_REFRESH_ITEMS)
    ]);

    const usualStoreId = household?.settings?.usualStoreId || null;
    const usualStore = usualStoreId
      ? await Store.findOne({ _id: usualStoreId, householdId })
      : null;

    const candidates = listItems
      .map(listItem => ({
        item: listItem.itemId,
        store: listItem.storeId || usualStore
      }))
      .filter(candidate => candidate.item?.upc && candidate.store?._id);

    const results = await mapWithConcurrency(candidates, 4, candidate => refreshOne({
      householdId,
      ...candidate
    }));

    const observations = [];
    let failedCount = 0;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        failedCount++;
        console.error('External price refresh failed:', result.reason?.message || result.reason);
        continue;
      }
      if (!result.value.observation) continue;
      observations.push({
        itemId: candidates[i].item._id,
        storeId: candidates[i].store._id,
        storeName: candidates[i].store.name,
        cached: result.value.cached,
        observation: serializeObservation(result.value.observation)
      });
    }

    res.json({
      provider: 'open-prices',
      checkedCount: candidates.length,
      observationCount: observations.length,
      failedCount,
      observations
    });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.get('/item/:itemId', requireAuth, async (req, res) => {
  try {
    const observations = await PriceObservation.find({
      householdId: req.user.householdId,
      itemId: req.params.itemId
    })
      .populate('storeId', 'name location')
      .sort({ observedAt: -1, fetchedAt: -1 })
      .limit(25)
      .lean();
    res.json(observations);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
