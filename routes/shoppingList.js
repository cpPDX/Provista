const express = require('express');
const router = express.Router();
const ShoppingListItem = require('../models/ShoppingListItem');
const PriceEntry = require('../models/PriceEntry');
const InventoryItem = require('../models/InventoryItem');
const Store = require('../models/Store');
const { requireAuth } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

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

      const priceData = await PriceEntry.aggregate([
        { $match: { householdId: req.user.householdId, itemId: li.itemId._id, status: 'approved' } },
        { $sort: { date: -1 } },
        { $group: { _id: '$storeId', pricePerUnit: { $first: '$pricePerUnit' }, finalPrice: { $first: '$finalPrice' }, quantity: { $first: '$quantity' }, date: { $first: '$date' }, storeId: { $first: '$storeId' } } },
        { $sort: { pricePerUnit: 1 } },
        { $limit: 1 },
        { $lookup: { from: 'stores', localField: 'storeId', foreignField: '_id', as: 'store' } },
        { $unwind: { path: '$store', preserveNullAndEmptyArrays: true } }
      ]);

      obj.bestPrice = priceData.length > 0 ? {
        pricePerUnit: priceData[0].pricePerUnit,
        finalPrice: priceData[0].finalPrice,
        quantity: priceData[0].quantity,
        store: priceData[0].store,
        date: priceData[0].date
      } : null;
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
    if (!req.body.itemId) return res.status(400).json({ error: 'itemId is required' });
    const item = new ShoppingListItem({
      ...req.body,
      householdId: req.user.householdId,
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

  const updatePantry = req.body.updatePantry !== false;
  const createdPriceIds = [];
  const inventoryBefore = [];

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
    const requestedStoreIds = [...new Set(requested.map(item => item.storeId).filter(Boolean).map(String))];
    if (requestedStoreIds.length) {
      const validStoreCount = await Store.countDocuments({ _id: { $in: requestedStoreIds }, householdId });
      if (validStoreCount !== requestedStoreIds.length) {
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

    let tripTotal = 0;
    let pricesRecorded = 0;
    let pantryUpdatedCount = 0;
    let needsPriceReviewCount = 0;

    for (const input of requested) {
      const listItem = checkedById.get(String(input.listItemId));
      if (!listItem?.itemId) throw new Error('Shopping-list item no longer has a catalog item');

      const quantity = Number(listItem.quantity || 1);
      const rawPrice = input.price;
      const price = rawPrice === null || rawPrice === undefined || rawPrice === '' ? null : Number(rawPrice);
      if (price !== null && (!Number.isFinite(price) || price < 0)) {
        return res.status(400).json({ error: 'price must be a non-negative number when provided' });
      }

      const storeId = input.storeId || listItem.storeId || null;
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
        const existing = await InventoryItem.findOne({ householdId, itemId: listItem.itemId._id }).lean();
        inventoryBefore.push({ itemId: listItem.itemId._id, existing });
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
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        pantryUpdatedCount += 1;
      }
    }

    const deleted = await ShoppingListItem.deleteMany({
      _id: { $in: listItemIds },
      householdId,
      checked: true
    });
    if (deleted.deletedCount !== requested.length) {
      throw new Error('Shopping list changed before the trip could be completed');
    }

    const thresholdItems = await InventoryItem.find({
      householdId,
      lowStockThreshold: { $ne: null }
    }).lean();
    const lowStockCount = thresholdItems.filter(item => item.quantity <= item.lowStockThreshold).length;

    res.json({
      purchasedCount: requested.length,
      tripTotal: Math.round(tripTotal * 100) / 100,
      pricesRecorded,
      needsPriceReviewCount,
      pantryUpdatedCount,
      lowStockCount
    });
  } catch (err) {
    // Keep the action all-or-nothing for the records this endpoint owns. The app
    // runs without Mongo transactions in some environments, so use compensating
    // rollback rather than requiring a replica set.
    await Promise.allSettled(createdPriceIds.map(id => PriceEntry.deleteOne({ _id: id, householdId })));
    await Promise.allSettled(inventoryBefore.map(({ itemId, existing }) => {
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
    const item = await ShoppingListItem.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      req.body,
      { new: true }
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
