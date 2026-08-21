const express = require('express');
const router = express.Router();
const ShoppingListItem = require('../models/ShoppingListItem');
const PriceEntry = require('../models/PriceEntry');
const InventoryItem = require('../models/InventoryItem');
const Item = require('../models/Item');
const Store = require('../models/Store');
const { requireAuth } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

async function householdItemExists(householdId, itemId) {
  return Boolean(await Item.exists({ _id: itemId, householdId }));
}

async function householdStoreExists(householdId, storeId) {
  if (!storeId) return true;
  return Boolean(await Store.exists({ _id: storeId, householdId }));
}

function priceContext(row) {
  if (!row) return null;
  return {
    pricePerUnit: row.pricePerUnit,
    finalPrice: row.finalPrice,
    quantity: row.quantity,
    store: row.store,
    date: row.date
  };
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

    const enriched = await Promise.all(listItems.map(async (li) => {
      const obj = { ...li };
      if (!li.itemId) return obj;

      // Fetch the latest approved price at each store once. bestPrice powers
      // recommendations; expectedPrice follows the user's preferred store when
      // one is assigned so checkout never records another store's price by mistake.
      const priceData = await PriceEntry.aggregate([
        { $match: { householdId: req.user.householdId, itemId: li.itemId._id, status: 'approved' } },
        { $sort: { date: -1 } },
        { $group: { _id: '$storeId', pricePerUnit: { $first: '$pricePerUnit' }, finalPrice: { $first: '$finalPrice' }, quantity: { $first: '$quantity' }, date: { $first: '$date' }, storeId: { $first: '$storeId' } } },
        { $sort: { pricePerUnit: 1 } },
        { $lookup: { from: 'stores', localField: 'storeId', foreignField: '_id', as: 'store' } },
        { $unwind: { path: '$store', preserveNullAndEmptyArrays: true } }
      ]);

      const best = priceData[0] || null;
      const assignedStoreId = li.storeId?._id || li.storeId || null;
      const assigned = assignedStoreId
        ? priceData.find(row => String(row.storeId) === String(assignedStoreId)) || null
        : null;

      obj.bestPrice = priceContext(best);
      obj.expectedPrice = priceContext(assigned || best);
      return obj;
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/shopping-list - add item (all roles)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { itemId, quantity = 1, storeId = null } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    if (!(await householdItemExists(req.user.householdId, itemId))) {
      return res.status(404).json({ error: 'Item not found in this household' });
    }
    if (!(await householdStoreExists(req.user.householdId, storeId))) {
      return res.status(404).json({ error: 'Store not found in this household' });
    }

    const parsedQuantity = Number(quantity);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    const item = new ShoppingListItem({
      householdId: req.user.householdId,
      itemId,
      quantity: parsedQuantity,
      storeId: storeId || null,
      checked: false,
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

// POST /api/shopping-list/complete-trip
// One household action closes the shopping loop: prices become purchase history
// (which powers Spend), purchased quantities can flow into Pantry, checked list
// rows disappear, and the response reports the newly recalculated low-stock state.
router.post('/complete-trip', requireAuth, async (req, res) => {
  const householdId = req.user.householdId;
  const requested = Array.isArray(req.body.items) ? req.body.items : [];
  if (!requested.length) return res.status(400).json({ error: 'items are required' });

  const listItemIds = requested.map(item => item.listItemId).filter(Boolean);
  if (listItemIds.length !== requested.length) {
    return res.status(400).json({ error: 'Each item requires listItemId' });
  }
  if (new Set(listItemIds.map(String)).size !== listItemIds.length) {
    return res.status(400).json({ error: 'Each shopping-list item may only appear once per trip' });
  }

  const createdPriceIds = [];
  const inventoryBefore = new Map();

  try {
    const checkedItems = await ShoppingListItem.find({
      _id: { $in: listItemIds },
      householdId,
      checked: true
    }).populate('itemId', 'name unit').lean();

    if (checkedItems.length !== requested.length) {
      return res.status(400).json({ error: 'All trip items must be checked shopping-list items in this household' });
    }

    const checkedById = new Map(checkedItems.map(item => [String(item._id), item]));
    const normalized = [];
    for (const input of requested) {
      const listItem = checkedById.get(String(input.listItemId));
      if (!listItem?.itemId) return res.status(400).json({ error: 'Shopping-list item no longer has a catalog item' });

      const rawPrice = input.price;
      const price = rawPrice === null || rawPrice === undefined || rawPrice === '' ? null : Number(rawPrice);
      if (price !== null && (!Number.isFinite(price) || price < 0)) {
        return res.status(400).json({ error: 'price must be a non-negative number when provided' });
      }

      const storeId = input.storeId || listItem.storeId || null;
      normalized.push({ input, listItem, price, storeId });
    }

    const effectiveStoreIds = [...new Set(normalized.map(row => row.storeId).filter(Boolean).map(String))];
    if (effectiveStoreIds.length) {
      const validStoreCount = await Store.countDocuments({ _id: { $in: effectiveStoreIds }, householdId });
      if (validStoreCount !== effectiveStoreIds.length) {
        return res.status(400).json({ error: 'Every selected store must belong to this household' });
      }
    }

    let purchaseDate = new Date();
    if (req.body.date) {
      const match = String(req.body.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      purchaseDate = new Date(`${req.body.date}T12:00:00.000Z`);
      if (Number.isNaN(purchaseDate.getTime())) return res.status(400).json({ error: 'Invalid purchase date' });
    }

    const updatePantry = req.body.updatePantry !== false;
    let tripTotal = 0;
    let pricesRecorded = 0;
    let pantryUpdatedCount = 0;
    let needsPriceReviewCount = 0;

    for (const row of normalized) {
      const { input, listItem, price, storeId } = row;
      const quantity = Number(listItem.quantity || 1);
      if (price !== null) tripTotal += price;

      if (price !== null && storeId) {
        const priceEntry = await PriceEntry.create({
          householdId,
          itemId: listItem.itemId._id,
          storeId,
          submittedBy: req.user._id,
          regularPrice: price,
          salePrice: null,
          couponAmount: null,
          finalPrice: price,
          quantity,
          pricePerUnit: quantity > 0 ? price / quantity : price,
          date: purchaseDate,
          source: 'shopping',
          // Completing a real household shopping trip is a purchase event, not a
          // catalog-edit proposal, so it immediately contributes to Spend.
          status: 'approved',
          reviewedBy: req.user._id,
          reviewedAt: new Date(),
          notes: input.priceSource === 'expected' ? 'Confirmed from shopping list expected price' : 'Recorded at Done Shopping'
        });
        createdPriceIds.push(priceEntry._id);
        pricesRecorded += 1;
      } else {
        needsPriceReviewCount += 1;
      }

      if (updatePantry) {
        const itemKey = String(listItem.itemId._id);
        if (!inventoryBefore.has(itemKey)) {
          inventoryBefore.set(itemKey, await InventoryItem.findOne({ householdId, itemId: listItem.itemId._id }).lean());
        }
        await InventoryItem.findOneAndUpdate(
          { householdId, itemId: listItem.itemId._id },
          {
            $inc: { quantity },
            $set: { lastUpdated: new Date(), lastUpdatedBy: req.user._id },
            $setOnInsert: {
              householdId,
              itemId: listItem.itemId._id,
              unit: listItem.itemId.unit || undefined
            }
          },
          // Do not ask Mongoose to inject schema defaults into $setOnInsert: the
          // quantity default would conflict with the $inc on new Pantry records.
          { upsert: true, new: true, setDefaultsOnInsert: false }
        );
        pantryUpdatedCount += 1;
      }
    }

    // Recalculate after Pantry writes but before clearing the list so there are no
    // fallible database reads after the destructive part of the operation.
    const thresholdItems = await InventoryItem.find({
      householdId,
      lowStockThreshold: { $ne: null }
    }).lean();
    const lowStockCount = thresholdItems.filter(item => item.quantity <= item.lowStockThreshold).length;

    const deleted = await ShoppingListItem.deleteMany({
      _id: { $in: listItemIds },
      householdId,
      checked: true
    });
    if (deleted.deletedCount !== requested.length) {
      throw new Error('Shopping list changed before the trip could be completed');
    }

    res.json({
      purchasedCount: requested.length,
      tripTotal: Math.round(tripTotal * 100) / 100,
      pricesRecorded,
      needsPriceReviewCount,
      pantryUpdatedCount,
      lowStockCount
    });
  } catch (err) {
    // Keep price/Pantry writes all-or-nothing without requiring Mongo transactions
    // (CI and some local setups use a standalone mongod rather than a replica set).
    await Promise.allSettled(createdPriceIds.map(id => PriceEntry.deleteOne({ _id: id, householdId })));
    await Promise.allSettled([...inventoryBefore.entries()].map(([itemId, existing]) => {
      if (existing) {
        return InventoryItem.updateOne(
          { householdId, itemId },
          {
            $set: {
              quantity: existing.quantity,
              unit: existing.unit,
              notes: existing.notes,
              lowStockThreshold: existing.lowStockThreshold,
              lastUpdated: existing.lastUpdated,
              lastUpdatedBy: existing.lastUpdatedBy
            }
          }
        );
      }
      return InventoryItem.deleteOne({ householdId, itemId });
    }));
    res.status(500).json({ error: serverErr(err) });
  }
});

// PUT /api/shopping-list/:id - update (all roles)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const update = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'checked')) {
      if (typeof req.body.checked !== 'boolean') return res.status(400).json({ error: 'checked must be boolean' });
      update.checked = req.body.checked;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'quantity')) {
      const quantity = Number(req.body.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'quantity must be a positive number' });
      update.quantity = quantity;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'storeId')) {
      const storeId = req.body.storeId || null;
      if (!(await householdStoreExists(req.user.householdId, storeId))) {
        return res.status(404).json({ error: 'Store not found in this household' });
      }
      update.storeId = storeId;
    }

    if (!Object.keys(update).length) return res.status(400).json({ error: 'No supported fields to update' });

    const item = await ShoppingListItem.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      update,
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
