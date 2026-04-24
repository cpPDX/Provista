const express = require('express');
const router = express.Router();
const InventoryItem = require('../models/InventoryItem');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

router.get('/low-stock', requireAuth, async (req, res) => {
  try {
    const items = await InventoryItem.find({
      householdId: req.user.householdId,
      lowStockThreshold: { $ne: null }
    }).populate('itemId', 'name brand unit size category isOrganic').lean();
    const low = items.filter(i => i.quantity <= i.lowStockThreshold);
    res.json(low);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = await InventoryItem.find({ householdId: req.user.householdId, quantity: { $gt: 0 } })
      .populate('itemId', 'name brand category unit size isOrganic')
      .sort({ updatedAt: -1 })
      .lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { itemId, quantity, unit, notes, lowStockThreshold } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    if (quantity !== undefined) {
      const q = parseFloat(quantity);
      if (isNaN(q) || q < 0) return res.status(400).json({ error: 'quantity must be a non-negative number' });
    }
    if (lowStockThreshold !== undefined && lowStockThreshold !== null) {
      const t = parseFloat(lowStockThreshold);
      if (isNaN(t) || t < 0) return res.status(400).json({ error: 'lowStockThreshold must be a non-negative number' });
    }

    const setFields = { lastUpdated: new Date(), lastUpdatedBy: req.user._id };
    if (quantity !== undefined) setFields.quantity = parseFloat(quantity);
    if (unit !== undefined) setFields.unit = unit;
    if (notes !== undefined) setFields.notes = notes;
    if (lowStockThreshold !== undefined) setFields.lowStockThreshold = lowStockThreshold;

    const inv = await InventoryItem.findOneAndUpdate(
      { householdId: req.user.householdId, itemId },
      { $set: setFields, $setOnInsert: { householdId: req.user.householdId, itemId, quantity: parseFloat(quantity) || 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate('itemId', 'name brand category unit size isOrganic');
    res.status(201).json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const update = { ...req.body, lastUpdated: new Date(), lastUpdatedBy: req.user._id };
    const inv = await InventoryItem.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      update,
      { new: true, runValidators: true }
    ).populate('itemId', 'name brand category unit size isOrganic');
    if (!inv) return res.status(404).json({ error: 'Inventory item not found' });
    res.json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const inv = await InventoryItem.findOneAndDelete({ _id: req.params.id, householdId: req.user.householdId });
    if (!inv) return res.status(404).json({ error: 'Inventory item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
