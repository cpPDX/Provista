const express = require('express');
const router = express.Router();
const PriceEntry = require('../models/PriceEntry');
const mongoose = require('mongoose');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// GET /api/prices/pending - list pending entries (admin+)
router.get('/pending', requireAuth, requireAdmin, async (req, res) => {
  try {
    const entries = await PriceEntry.find({ householdId: req.user.householdId, status: 'pending' })
      .populate('itemId', 'name unit category')
      .populate('storeId', 'name')
      .populate('submittedBy', 'name')
      .sort({ createdAt: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/prices/:id/approve - approve (with optional edits) (admin+)
router.put('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const update = {
      status: 'approved',
      reviewedBy: req.user._id,
      reviewedAt: new Date()
    };
    // Allow editing any fields during approval
    const editable = ['price', 'quantity', 'isOnSale', 'saleLabel', 'date', 'notes', 'storeId'];
    editable.forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });

    // Recalculate pricePerUnit if price or quantity changed
    const existing = await PriceEntry.findOne({ _id: req.params.id, householdId: req.user.householdId });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    const price = update.price ?? existing.price;
    const quantity = update.quantity ?? existing.quantity;
    update.pricePerUnit = price / quantity;

    const entry = await PriceEntry.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      update,
      { new: true }
    ).populate('itemId', 'name unit category').populate('storeId', 'name').populate('submittedBy', 'name');
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/prices/:id/reject - reject a pending entry (admin+)
router.delete('/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    const entry = await PriceEntry.findOneAndDelete({
      _id: req.params.id,
      householdId: req.user.householdId,
      status: 'pending'
    });
    if (!entry) return res.status(404).json({ error: 'Pending entry not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prices/compare/:itemId - latest approved price per store
router.get('/compare/:itemId', requireAuth, async (req, res) => {
  try {
    const entries = await PriceEntry.aggregate([
      {
        $match: {
          householdId: req.user.householdId,
          itemId: mongoose.Types.ObjectId.createFromHexString(req.params.itemId),
          status: 'approved'
        }
      },
      { $sort: { date: -1 } },
      { $group: { _id: '$storeId', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $lookup: { from: 'stores', localField: 'storeId', foreignField: '_id', as: 'store' } },
      { $unwind: '$store' },
      { $lookup: { from: 'items', localField: 'itemId', foreignField: '_id', as: 'item' } },
      { $unwind: '$item' },
      { $sort: { pricePerUnit: 1 } }
    ]);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prices/history/:itemId - approved history + current user's pending
router.get('/history/:itemId', requireAuth, async (req, res) => {
  try {
    const baseQuery = {
      householdId: req.user.householdId,
      itemId: req.params.itemId
    };
    // Return approved entries + this user's own pending entries
    const entries = await PriceEntry.find({
      ...baseQuery,
      $or: [{ status: 'approved' }, { status: 'pending', submittedBy: req.user._id }]
    })
      .populate('storeId', 'name location')
      .populate('itemId', 'name unit category')
      .populate('submittedBy', 'name')
      .sort({ date: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/prices - list approved entries (with optional filters)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { itemId, storeId, startDate, endDate } = req.query;
    const query = { householdId: req.user.householdId, status: 'approved' };
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

// POST /api/prices - create entry; admin+ = auto-approved, member = pending
router.post('/', requireAuth, async (req, res) => {
  try {
    const { price, quantity } = req.body;
    const pricePerUnit = quantity > 0 ? price / quantity : price;
    const isAdmin = ['admin', 'owner'].includes(req.user.role);
    const entry = new PriceEntry({
      ...req.body,
      pricePerUnit,
      householdId: req.user.householdId,
      submittedBy: req.user._id,
      status: isAdmin ? 'approved' : 'pending',
      reviewedBy: isAdmin ? req.user._id : null,
      reviewedAt: isAdmin ? new Date() : null
    });
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

// DELETE /api/prices/:id - delete (admin+)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const entry = await PriceEntry.findOneAndDelete({ _id: req.params.id, householdId: req.user.householdId });
    if (!entry) return res.status(404).json({ error: 'Price entry not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
