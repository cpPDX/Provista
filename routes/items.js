const express = require('express');
const router = express.Router();
const Item = require('../models/Item');

// GET /api/items - list all items, with optional search
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = {};
    if (search && search.length >= 2) {
      query = { name: { $regex: search, $options: 'i' } };
    }
    const items = await Item.find(query).sort({ name: 1 }).limit(search ? 8 : 0);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/items - create item
router.post('/', async (req, res) => {
  try {
    const item = new Item(req.body);
    await item.save();
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/items/:id - update item
router.put('/:id', async (req, res) => {
  try {
    const item = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/items/:id - delete item
router.delete('/:id', async (req, res) => {
  try {
    const item = await Item.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
