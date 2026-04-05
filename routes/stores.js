const express = require('express');
const router = express.Router();
const Store = require('../models/Store');

// GET /api/stores
router.get('/', async (req, res) => {
  try {
    const stores = await Store.find().sort({ name: 1 });
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stores
router.post('/', async (req, res) => {
  try {
    const store = new Store(req.body);
    await store.save();
    res.status(201).json(store);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/stores/:id
router.put('/:id', async (req, res) => {
  try {
    const store = await Store.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json(store);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/stores/:id
router.delete('/:id', async (req, res) => {
  try {
    const store = await Store.findByIdAndDelete(req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
