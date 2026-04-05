const express = require('express');
const router = express.Router();
const PriceEntry = require('../models/PriceEntry');
const { requireAuth } = require('../middleware/auth');

// GET /api/spend/summary - 6-month totals
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const results = await PriceEntry.aggregate([
      { $match: { householdId: req.user.householdId, status: 'approved', date: { $gte: sixMonthsAgo } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, total: { $sum: '$finalPrice' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json(results.map(r => ({
      month: `${r._id.year}-${String(r._id.month).padStart(2, '0')}`,
      total: Math.round(r.total * 100) / 100
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/spend?month=YYYY-MM
router.get('/', requireAuth, async (req, res) => {
  try {
    const monthStr = req.query.month || new Date().toISOString().slice(0, 7);
    const [year, month] = monthStr.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const entries = await PriceEntry.find({
      householdId: req.user.householdId,
      status: 'approved',
      date: { $gte: start, $lt: end }
    })
      .populate('itemId', 'name category')
      .populate('storeId', 'name');

    let total = 0;
    const byCategory = {};
    const byStore = {};

    for (const e of entries) {
      total += e.finalPrice;
      const cat = e.itemId?.category || 'Unknown';
      const store = e.storeId?.name || 'Unknown';
      byCategory[cat] = (byCategory[cat] || 0) + e.finalPrice;
      byStore[store] = (byStore[store] || 0) + e.finalPrice;
    }

    const round = v => Math.round(v * 100) / 100;
    res.json({
      month: monthStr,
      total: round(total),
      byCategory: Object.entries(byCategory).map(([name, amount]) => ({ name, amount: round(amount) })).sort((a, b) => b.amount - a.amount),
      byStore: Object.entries(byStore).map(([name, amount]) => ({ name, amount: round(amount) })).sort((a, b) => b.amount - a.amount)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
