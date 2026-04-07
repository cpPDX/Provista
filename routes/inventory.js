const express = require('express');
const router = express.Router();
const InventoryItem = require('../models/InventoryItem');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/low-stock', requireAuth, async (req, res) => {
  try {
    const items = await InventoryItem.find({
      householdId: req.user.householdId,
      lowStockThreshold: { $ne: null }
    }).populate('itemId', 'name unit category');
    const low = items.filter(i => i.quantity <= i.lowStockThreshold);
    res.json(low);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = await InventoryItem.find({ householdId: req.user.householdId, quantity: { $gt: 0 } })
      .populate('itemId', 'name category unit')
      .sort({ updatedAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { itemId, quantity, unit, notes } = req.body;
    let inv = await InventoryItem.findOne({ householdId: req.user.householdId, itemId });
    if (inv) {
      inv.quantity = quantity !== undefined ? quantity : inv.quantity;
      if (unit !== undefined) inv.unit = unit;
      if (notes !== undefined) inv.notes = notes;
      inv.lastUpdated = new Date();
      inv.lastUpdatedBy = req.user._id;
      await inv.save();
    } else {
      inv = new InventoryItem({
        householdId: req.user.householdId,
        itemId,
        quantity: quantity || 0,
        unit,
        notes,
        lastUpdated: new Date(),
        lastUpdatedBy: req.user._id
      });
      await inv.save();
    }
    await inv.populate('itemId', 'name category unit');
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
    ).populate('itemId', 'name category unit');
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
