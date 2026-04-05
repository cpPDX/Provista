const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/items - list or search items scoped to household
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    const query = { householdId: req.user.householdId };
    if (search && search.length >= 2) {
      query.name = { $regex: search, $options: 'i' };
    }
    const items = await Item.find(query).sort({ name: 1 }).limit(search ? 8 : 0);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/items - create item (admin+)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const item = new Item({ ...req.body, householdId: req.user.householdId, isSeeded: false });
    await item.save();
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/items/:id - update item (admin+)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const item = await Item.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/items/:id - delete item (admin+)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const item = await Item.findOneAndDelete({ _id: req.params.id, householdId: req.user.householdId });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
