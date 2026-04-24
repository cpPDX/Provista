const express = require('express');
const router = express.Router();
const PriceEntry = require('../models/PriceEntry');
const mongoose = require('mongoose');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

function calcFinalPrice(regularPrice, salePrice, couponAmount) {
  const base = (salePrice != null && salePrice < regularPrice) ? salePrice : regularPrice;
  return base - (couponAmount ?? 0);
}

// GET /api/prices/pending - list pending entries (admin+)
router.get('/pending', requireAuth, requireAdmin, async (req, res) => {
  try {
    const entries = await PriceEntry.find({ householdId: req.user.householdId, status: 'pending' })
      .populate('itemId', 'name brand unit size category isOrganic')
      .populate('storeId', 'name')
      .populate('submittedBy', 'name')
      .sort({ createdAt: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// PUT /api/prices/:id/approve - approve with optional edits (admin+)
router.put('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await PriceEntry.findOne({ _id: req.params.id, householdId: req.user.householdId });
    if (!existing) return res.status(404).json({ error: 'Entry not found' });

    const update = {
      status: 'approved',
      reviewedBy: req.user._id,
      reviewedAt: new Date()
    };

    const editable = ['regularPrice', 'salePrice', 'couponAmount', 'couponCode', 'date', 'notes', 'storeId', 'quantity'];
    editable.forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });

    if (update.quantity !== undefined) {
      update.quantity = parseFloat(update.quantity);
      if (isNaN(update.quantity) || update.quantity <= 0)
        return res.status(400).json({ error: 'quantity must be a positive number' });
    }

    // Recalculate derived fields
    const regularPrice = update.regularPrice ?? existing.regularPrice;
    const salePrice = update.salePrice !== undefined ? update.salePrice : existing.salePrice;
    const couponAmount = update.couponAmount !== undefined ? update.couponAmount : existing.couponAmount;
    const quantity = update.quantity ?? existing.quantity;
    update.finalPrice = calcFinalPrice(regularPrice, salePrice, couponAmount);
    update.pricePerUnit = update.finalPrice / quantity;

    const entry = await PriceEntry.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      update,
      { new: true }
    ).populate('itemId', 'name brand unit size category isOrganic').populate('storeId', 'name').populate('submittedBy', 'name');
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// DELETE /api/prices/:id/reject - reject pending entry (admin+)
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
    res.status(500).json({ error: serverErr(err) });
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
      { $unwind: { path: '$store', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'items', localField: 'itemId', foreignField: '_id', as: 'item' } },
      { $unwind: { path: '$item', preserveNullAndEmptyArrays: true } },
      { $sort: { pricePerUnit: 1 } }
    ]);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// GET /api/prices/history/:itemId - approved history + current user's pending
router.get('/history/:itemId', requireAuth, async (req, res) => {
  try {
    const entries = await PriceEntry.find({
      householdId: req.user.householdId,
      itemId: req.params.itemId,
      $or: [{ status: 'approved' }, { status: 'pending', submittedBy: req.user._id }]
    })
      .populate('storeId', 'name location')
      .populate('itemId', 'name brand unit size category isOrganic')
      .populate('submittedBy', 'name')
      .sort({ date: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// GET /api/prices/last-purchased/:itemId - most recent approved entry per store
router.get('/last-purchased/:itemId', requireAuth, async (req, res) => {
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
      {
        $group: {
          _id: '$storeId',
          finalPrice: { $first: '$finalPrice' },
          pricePerUnit: { $first: '$pricePerUnit' },
          date: { $first: '$date' },
          storeId: { $first: '$storeId' }
        }
      },
      { $lookup: { from: 'stores', localField: 'storeId', foreignField: '_id', as: 'store' } },
      { $unwind: { path: '$store', preserveNullAndEmptyArrays: true } },
      { $sort: { date: -1 } }
    ]);
    res.json(entries.map(e => ({
      storeId: e.storeId,
      store: { name: e.store.name },
      finalPrice: e.finalPrice,
      pricePerUnit: e.pricePerUnit,
      date: e.date
    })));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// GET /api/prices - list approved entries with optional filters
router.get('/', requireAuth, async (req, res) => {
  try {
    const { itemId, storeId, startDate, endDate } = req.query;
    const query = {
      householdId: req.user.householdId,
      $or: [{ status: 'approved' }, { status: 'pending', submittedBy: req.user._id }]
    };
    if (itemId) query.itemId = itemId;
    if (storeId) query.storeId = storeId;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }
    const entries = await PriceEntry.find(query)
      .populate('itemId', 'name brand unit size category isOrganic')
      .populate('storeId', 'name location')
      .sort({ date: -1 })
      .limit(100);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/prices - create entry; admin+ = auto-approved, member = pending
router.post('/', requireAuth, async (req, res) => {
  try {
    const { regularPrice, salePrice, couponAmount, couponCode, quantity } = req.body;

    if (!req.body.itemId) return res.status(400).json({ error: 'itemId is required' });
    if (!req.body.storeId) return res.status(400).json({ error: 'storeId is required' });
    if (regularPrice === undefined || regularPrice === null) return res.status(400).json({ error: 'regularPrice is required' });
    const rp = parseFloat(regularPrice);
    if (isNaN(rp) || rp < 0) return res.status(400).json({ error: 'regularPrice must be a non-negative number' });
    const qty = quantity !== undefined ? parseFloat(quantity) : 1;
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be a positive number' });
    if (salePrice !== undefined && salePrice !== null) {
      const sp = parseFloat(salePrice);
      if (isNaN(sp) || sp < 0) return res.status(400).json({ error: 'salePrice must be a non-negative number' });
    }
    if (couponAmount !== undefined && couponAmount !== null) {
      const ca = parseFloat(couponAmount);
      if (isNaN(ca) || ca < 0) return res.status(400).json({ error: 'couponAmount must be a non-negative number' });
    }

    const finalPrice = calcFinalPrice(rp, salePrice ?? null, couponAmount ?? null);
    const pricePerUnit = finalPrice / qty;
    const isAdmin = ['admin', 'owner'].includes(req.user.role);

    const entry = new PriceEntry({
      ...req.body,
      regularPrice: rp,
      quantity: qty,
      finalPrice,
      pricePerUnit,
      salePrice: salePrice ?? null,
      couponAmount: couponAmount ?? null,
      couponCode: couponCode ?? null,
      householdId: req.user.householdId,
      submittedBy: req.user._id,
      status: isAdmin ? 'approved' : 'pending',
      reviewedBy: isAdmin ? req.user._id : null,
      reviewedAt: isAdmin ? new Date() : null,
      source: ['manual', 'csv'].includes(req.body.source) ? req.body.source : 'manual'
    });
    await entry.save();
    const populated = await entry.populate([
      { path: 'itemId', select: 'name brand unit size category isOrganic' },
      { path: 'storeId', select: 'name location' }
    ]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/prices/:id (admin+)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const entry = await PriceEntry.findOneAndDelete({ _id: req.params.id, householdId: req.user.householdId });
    if (!entry) return res.status(404).json({ error: 'Price entry not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
