const express = require('express');
const router = express.Router();
const PriceEntry = require('../models/PriceEntry');

// GET /api/prices/compare/:itemId - latest price per store for an item
router.get('/compare/:itemId', async (req, res) => {
  try {
    // Get the most recent entry per store for this item
    const entries = await PriceEntry.aggregate([
      { $match: { itemId: require('mongoose').Types.ObjectId.createFromHexString(req.params.itemId) } },
      { $sort: { date: -1 } },
      {
        $group: {
          _id: '$storeId',
          doc: { $first: '$$ROOT' }
        }
      },
      { $replaceRoot: { newRoot: '$doc' } },
      {
        $lookup: {
          from: 'stores',
          localField: 'storeId',
          foreignField: '_id',
          as: 'store'
        }
      },
      { $unwind: '$store' },
      {
        $lookup: {
          from: 'items',
          localField: 'itemId',
          foreignField: '_id',
          as: 'item'
        }
      },
      { $unwind: '$item' },
      { $sort: { pricePerUnit: 1 } }
    ]);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prices/history/:itemId - full price history for an item
router.get('/history/:itemId', async (req, res) => {
  try {
    const entries = await PriceEntry.find({ itemId: req.params.itemId })
      .populate('storeId', 'name location')
      .populate('itemId', 'name unit category')
      .sort({ date: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prices - list price entries with optional filters
router.get('/', async (req, res) => {
  try {
    const { itemId, storeId, startDate, endDate } = req.query;
    const query = {};
    if (itemId) query.itemId = itemId;
    if (storeId) query.storeId = storeId;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    const entries = await PriceEntry.find(query)
      .populate('itemId', 'name unit category')
      .populate('storeId', 'name location')
      .sort({ date: -1 })
      .limit(100);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prices - create price entry
router.post('/', async (req, res) => {
  try {
    const { price, quantity } = req.body;
    const pricePerUnit = quantity > 0 ? price / quantity : price;
    const entry = new PriceEntry({ ...req.body, pricePerUnit });
    await entry.save();
    const populated = await entry.populate([
      { path: 'itemId', select: 'name unit category' },
      { path: 'storeId', select: 'name location' }
    ]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/prices/:id
router.delete('/:id', async (req, res) => {
  try {
    const entry = await PriceEntry.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Price entry not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
