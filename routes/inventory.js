const express = require('express');
const router = express.Router();
const InventoryItem = require('../models/InventoryItem');

// GET /api/inventory
router.get('/', async (req, res) => {
  try {
    const items = await InventoryItem.find({ quantity: { $gt: 0 } })
      .populate('itemId', 'name category unit')
      .sort({ 'itemId.name': 1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory - add or update inventory item
router.post('/', async (req, res) => {
  try {
    const { itemId, quantity, unit, notes } = req.body;
    let inv = await InventoryItem.findOne({ itemId });
    if (inv) {
      inv.quantity = quantity !== undefined ? quantity : inv.quantity;
      if (unit !== undefined) inv.unit = unit;
      if (notes !== undefined) inv.notes = notes;
      inv.lastUpdated = new Date();
      await inv.save();
    } else {
      inv = new InventoryItem({ itemId, quantity: quantity || 0, unit, notes, lastUpdated: new Date() });
      await inv.save();
    }
    await inv.populate('itemId', 'name category unit');
    res.status(201).json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/inventory/:id
router.put('/:id', async (req, res) => {
  try {
    const update = { ...req.body, lastUpdated: new Date() };
    const inv = await InventoryItem.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true })
      .populate('itemId', 'name category unit');
    if (!inv) return res.status(404).json({ error: 'Inventory item not found' });
    res.json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/inventory/:id
router.delete('/:id', async (req, res) => {
  try {
    const inv = await InventoryItem.findByIdAndDelete(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Inventory item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
