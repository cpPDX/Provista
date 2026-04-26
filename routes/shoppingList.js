const express = require('express');
const router = express.Router();
const ShoppingListItem = require('../models/ShoppingListItem');
const PriceEntry = require('../models/PriceEntry');
const { requireAuth, requireAdmin } = require('../middleware/auth');

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
