const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Item = require('../models/Item');
const Household = require('../models/Household');
const Store = require('../models/Store');
const ShoppingListItem = require('../models/ShoppingListItem');
const PriceEntry = require('../models/PriceEntry');
const { completeShoppingTrip, ShoppingTripError } = require('../services/completeShoppingTrip');
const { requireAuth } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

function daysSince(date) {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// GET /api/shopping-list - list with price context
router.get('/', requireAuth, async (req, res) => {
  try {
    const listItems = await ShoppingListItem.find({ householdId: req.user.householdId })
      .populate('itemId', 'name brand category unit size isOrganic')
      .populate('storeId', 'name')
      .populate('addedBy', 'name')
      .sort({ checked: 1, addedAt: -1 })
      .lean();
    const itemIds = listItems.map(item => item.itemId?._id).filter(Boolean);
    const [household, latestPrices] = await Promise.all([
      Household.findById(req.user.householdId).select('settings').lean(),
      itemIds.length ? PriceEntry.aggregate([
        { $match: { householdId: req.user.householdId, itemId: { $in: itemIds }, status: 'approved' } },
        { $sort: { date: -1, _id: -1 } },
        { $group: {
          _id: { itemId: '$itemId', storeId: '$storeId' },
          priceEntryId: { $first: '$_id' },
          pricePerUnit: { $first: '$pricePerUnit' },
          finalPrice: { $first: '$finalPrice' },
          quantity: { $first: '$quantity' },
          date: { $first: '$date' },
          entryCount: { $sum: 1 }
        } },
        { $lookup: { from: 'stores', localField: '_id.storeId', foreignField: '_id', as: 'store' } },
        { $unwind: { path: '$store', preserveNullAndEmptyArrays: false } }
      ]) : []
    ]);

    const freshnessDays = Number(household?.settings?.priceFreshnessDays) || 30;
    const savingsThreshold = Number(household?.settings?.additionalStopSavingsThreshold ?? 10);
    const pricesByItem = new Map();
    const storeCoverage = new Map();
    for (const price of latestPrices) {
      const itemKey = String(price._id.itemId);
      const storeKey = String(price._id.storeId);
      const ageDays = daysSince(price.date);
      const option = {
        priceEntryId: price.priceEntryId,
        pricePerUnit: price.pricePerUnit,
        finalPrice: price.finalPrice,
        quantity: price.quantity,
        date: price.date,
        ageDays,
        isStale: ageDays > freshnessDays,
        store: price.store
      };
      if (!pricesByItem.has(itemKey)) pricesByItem.set(itemKey, []);
      pricesByItem.get(itemKey).push(option);
      const coverage = storeCoverage.get(storeKey) || { itemCount: 0, entryCount: 0, store: price.store };
      coverage.itemCount += 1;
      coverage.entryCount += price.entryCount;
      storeCoverage.set(storeKey, coverage);
    }

    let usualStore = null;
    const configuredUsualStoreId = household?.settings?.usualStoreId;
    if (configuredUsualStoreId) {
      usualStore = await Store.findOne({ _id: configuredUsualStoreId, householdId: req.user.householdId })
        .select('name location')
        .lean();
    }
    if (!usualStore && storeCoverage.size) {
      usualStore = [...storeCoverage.values()]
        .sort((a, b) => b.itemCount - a.itemCount || b.entryCount - a.entryCount)[0].store;
    }
    const usualStoreId = usualStore ? String(usualStore._id) : null;

    const priceContextByItem = new Map();
    const savingsByStore = new Map();
    for (const listItem of listItems) {
      if (!listItem.itemId) continue;
      const itemKey = String(listItem.itemId._id);
      const options = (pricesByItem.get(itemKey) || []).sort((a, b) => a.pricePerUnit - b.pricePerUnit);
      const recentOptions = options.filter(option => !option.isStale);
      const usualPrice = usualStoreId
        ? options.find(option => String(option.store._id) === usualStoreId) || null
        : null;
      const cheapestRecent = recentOptions[0] || null;
      const quantity = Number(listItem.quantity) || 1;
      let candidateSavings = 0;
      if (usualPrice && !usualPrice.isStale && cheapestRecent && String(cheapestRecent.store._id) !== usualStoreId) {
        candidateSavings = roundCurrency((usualPrice.pricePerUnit - cheapestRecent.pricePerUnit) * quantity);
        if (candidateSavings > 0) {
          const storeKey = String(cheapestRecent.store._id);
          const candidate = savingsByStore.get(storeKey) || { store: cheapestRecent.store, savings: 0 };
          candidate.savings = roundCurrency(candidate.savings + candidateSavings);
          savingsByStore.set(storeKey, candidate);
        }
      }
      priceContextByItem.set(itemKey, { options, recentOptions, cheapestRecent, candidateSavings });
    }

    const additionalStore = [...savingsByStore.values()]
      .filter(candidate => candidate.savings >= savingsThreshold)
      .sort((a, b) => b.savings - a.savings)[0] || null;

    const enriched = listItems.map(listItem => {
      const obj = { ...listItem };
      if (!listItem.itemId) return obj;
      const itemKey = String(listItem.itemId._id);
      const context = priceContextByItem.get(itemKey) || {
        options: [], recentOptions: [], cheapestRecent: null, candidateSavings: 0
      };
      const explicitStore = listItem.storeId || null;
      const qualifiesForAdditionalStop = Boolean(
        !explicitStore && additionalStore && context.cheapestRecent &&
        String(context.cheapestRecent.store._id) === String(additionalStore.store._id) &&
        context.candidateSavings > 0
      );
      const tripStore = explicitStore || (qualifiesForAdditionalStop ? additionalStore.store : usualStore);
      const tripPrice = tripStore
        ? context.recentOptions.find(option => String(option.store._id) === String(tripStore._id)) || null
        : context.cheapestRecent;
      const latestSeen = [...context.options].sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;

      obj.priceOptions = context.options;
      obj.bestPrice = context.cheapestRecent;
      obj.latestSeenPrice = latestSeen;
      obj.tripStore = tripStore || null;
      obj.tripPrice = tripPrice;
      obj.priceContext = {
        usualStore: usualStore || null,
        additionalStore: additionalStore ? additionalStore.store : null,
        estimatedAdditionalStopSavings: additionalStore?.savings || 0,
        savingsThreshold,
        freshnessDays
      };
      return obj;
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/shopping-list/from-meal - add reviewed meal-note matches in one
// household-scoped batch, skipping anything already on the list.
router.post('/from-meal', requireAuth, async (req, res) => {
  try {
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }
    if (req.body.items.length > 25) {
      return res.status(400).json({ error: 'No more than 25 items can be added at once' });
    }

    const requestedById = new Map();
    for (const entry of req.body.items) {
      const itemId = String(entry?.itemId || '');
      const quantity = Number(entry?.quantity ?? 1);
      if (!mongoose.isValidObjectId(itemId)) return res.status(400).json({ error: 'Each itemId must be valid' });
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 99) {
        return res.status(400).json({ error: 'Each quantity must be greater than 0 and no more than 99' });
      }
      const existing = requestedById.get(itemId);
      requestedById.set(itemId, Math.max(existing || 0, quantity));
    }

    const householdId = req.user.householdId;
    const itemIds = [...requestedById.keys()];
    const catalogItems = await Item.find({ _id: { $in: itemIds }, householdId })
      .select('name brand category unit')
      .lean();
    if (catalogItems.length !== itemIds.length) {
      return res.status(404).json({ error: 'One or more catalog items were not found in this household' });
    }

    const existingListItems = await ShoppingListItem.find({
      householdId,
      itemId: { $in: itemIds }
    }).select('itemId').lean();
    const existingIds = new Set(existingListItems.map(entry => String(entry.itemId)));
    const now = new Date();
    const documents = itemIds
      .filter(itemId => !existingIds.has(itemId))
      .map(itemId => ({
        householdId,
        itemId,
        quantity: requestedById.get(itemId),
        addedBy: req.user._id,
        addedAt: now
      }));

    if (documents.length) await ShoppingListItem.insertMany(documents);
    const catalogById = new Map(catalogItems.map(item => [String(item._id), item]));
    res.status(documents.length ? 201 : 200).json({
      addedCount: documents.length,
      skippedCount: existingIds.size,
      addedItems: documents.map(document => ({
        itemId: String(document.itemId),
        name: catalogById.get(String(document.itemId))?.name,
        quantity: document.quantity
      })),
      skippedItems: [...existingIds].map(itemId => ({
        itemId,
        name: catalogById.get(itemId)?.name
      }))
    });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/shopping-list/complete - finish one shopping trip across list,
// Pantry, price history, Spend, and low-stock state.
router.post('/complete', requireAuth, async (req, res) => {
  try {
    const household = await Household.findById(req.user.householdId)
      .select('settings.strictPriceReview')
      .lean();
    const summary = await completeShoppingTrip({
      householdId: req.user.householdId,
      userId: req.user._id,
      role: req.user.role,
      strictPriceReview: Boolean(household?.settings?.strictPriceReview),
      body: req.body
    });
    res.status(summary.idempotent ? 200 : 201).json(summary);
  } catch (err) {
    const status = err instanceof ShoppingTripError ? err.status : 500;
    res.status(status).json({ error: err instanceof ShoppingTripError ? err.message : serverErr(err) });
  }
});

// POST /api/shopping-list - add item (all roles)
router.post('/', requireAuth, async (req, res) => {
  try {
    if (!req.body.itemId) return res.status(400).json({ error: 'itemId is required' });
    const quantity = Number(req.body.quantity ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 99) {
      return res.status(400).json({ error: 'quantity must be greater than 0 and no more than 99' });
    }
    const itemExists = await Item.exists({ _id: req.body.itemId, householdId: req.user.householdId });
    if (!itemExists) return res.status(404).json({ error: 'Item not found in this household' });
    const storeId = req.body.storeId || null;
    if (storeId && !(await Store.exists({ _id: storeId, householdId: req.user.householdId }))) {
      return res.status(404).json({ error: 'Store not found in this household' });
    }
    const item = new ShoppingListItem({
      householdId: req.user.householdId,
      itemId: req.body.itemId,
      quantity,
      storeId,
      addedBy: req.user._id,
      addedAt: new Date()
    });
    await item.save();
    await item.populate('itemId', 'name brand category unit size isOrganic');
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/shopping-list/:id - update (all roles)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const update = {};
    if (req.body.checked !== undefined) update.checked = Boolean(req.body.checked);
    if (req.body.quantity !== undefined) {
      const quantity = Number(req.body.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 99) {
        return res.status(400).json({ error: 'quantity must be greater than 0 and no more than 99' });
      }
      update.quantity = quantity;
    }
    if (req.body.storeId !== undefined) {
      const storeId = req.body.storeId || null;
      if (storeId && !(await Store.exists({ _id: storeId, householdId: req.user.householdId }))) {
        return res.status(404).json({ error: 'Store not found in this household' });
      }
      update.storeId = storeId;
    }
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
    const item = await ShoppingListItem.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      { $set: update },
      { new: true, runValidators: true }
    ).populate('itemId', 'name brand category unit size isOrganic');
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/shopping-list - clear list (admin+ can clear all; all roles can clear checked)
router.delete('/', requireAuth, async (req, res) => {
  try {
    const { checkedOnly } = req.query;
    if (checkedOnly === 'true') {
      await ShoppingListItem.deleteMany({ householdId: req.user.householdId, checked: true });
    } else {
      if (!['admin', 'owner'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Admin role required to clear entire list' });
      }
      await ShoppingListItem.deleteMany({ householdId: req.user.householdId });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// DELETE /api/shopping-list/:id - remove item (all roles)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const item = await ShoppingListItem.findOneAndDelete({
      _id: req.params.id,
      householdId: req.user.householdId
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
