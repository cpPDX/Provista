const express = require('express');
const router = express.Router();
const PriceEntry = require('../models/PriceEntry');

// GET /api/spend/summary - monthly totals for last 6 months
router.get('/summary', async (req, res) => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const results = await PriceEntry.aggregate([
      { $match: { date: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' }
          },
          total: { $sum: '$price' }
        }
      },
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

// GET /api/spend?month=YYYY-MM - spend breakdown for a given month
router.get('/', async (req, res) => {
  try {
    const monthStr = req.query.month || new Date().toISOString().slice(0, 7);
    const [year, month] = monthStr.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const entries = await PriceEntry.find({ date: { $gte: start, $lt: end } })
      .populate('itemId', 'name category')
      .populate('storeId', 'name');

    let total = 0;
    const byCategory = {};
    const byStore = {};

    for (const e of entries) {
      total += e.price;
      const cat = e.itemId?.category || 'Unknown';
      const store = e.storeId?.name || 'Unknown';
      byCategory[cat] = (byCategory[cat] || 0) + e.price;
      byStore[store] = (byStore[store] || 0) + e.price;
    }

    const round = v => Math.round(v * 100) / 100;

    res.json({
      month: monthStr,
      total: round(total),
      byCategory: Object.entries(byCategory)
        .map(([name, amount]) => ({ name, amount: round(amount) }))
        .sort((a, b) => b.amount - a.amount),
      byStore: Object.entries(byStore)
        .map(([name, amount]) => ({ name, amount: round(amount) }))
        .sort((a, b) => b.amount - a.amount)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
