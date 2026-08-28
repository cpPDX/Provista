const express = require('express');
const router = express.Router();
const PriceEntry = require('../models/PriceEntry');
const ShoppingTrip = require('../models/ShoppingTrip');
const { requireAuth } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

// GET /api/spend/summary - 6-month totals
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const [priceResults, tripResults] = await Promise.all([
      PriceEntry.aggregate([
        { $match: { householdId: req.user.householdId, status: 'approved', shoppingTripId: null, date: { $gte: sixMonthsAgo } } },
        { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, total: { $sum: '$finalPrice' } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]),
      ShoppingTrip.aggregate([
        { $match: { householdId: req.user.householdId, status: 'completed', completedAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { year: { $year: '$completedAt' }, month: { $month: '$completedAt' } }, total: { $sum: '$total' } } },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ])
    ]);

    const totalsByMonth = new Map();
    for (const result of [...priceResults, ...tripResults]) {
      const month = `${result._id.year}-${String(result._id.month).padStart(2, '0')}`;
      totalsByMonth.set(month, (totalsByMonth.get(month) || 0) + result.total);
    }

    res.json([...totalsByMonth.entries()]
      .sort(([monthA], [monthB]) => monthA.localeCompare(monthB))
      .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 })));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// GET /api/spend?month=YYYY-MM
router.get('/', requireAuth, async (req, res) => {
  try {
    const monthStr = req.query.month || new Date().toISOString().slice(0, 7);
    const [year, month] = monthStr.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const [entries, trips] = await Promise.all([
      PriceEntry.find({
        householdId: req.user.householdId,
        status: 'approved',
        shoppingTripId: null,
        date: { $gte: start, $lt: end }
      })
        .populate('itemId', 'name brand category size')
        .populate('storeId', 'name'),
      ShoppingTrip.find({
        householdId: req.user.householdId,
        status: 'completed',
        completedAt: { $gte: start, $lt: end }
      }).lean()
    ]);

    let total = 0;
    const byCategory = {};
    const byStore = new Map();

    const addStoreAmount = (storeId, storeName, amount) => {
      const id = storeId ? String(storeId) : '';
      const name = storeName || 'Unknown';
      const key = id || `name:${name}`;
      const current = byStore.get(key) || { name, storeId: id || null, amount: 0 };
      current.amount += amount;
      byStore.set(key, current);
    };

    for (const e of entries) {
      total += e.finalPrice;
      const cat = e.itemId?.category || 'Unknown';
      byCategory[cat] = (byCategory[cat] || 0) + e.finalPrice;
      addStoreAmount(e.storeId?._id || e.storeId, e.storeId?.name, e.finalPrice);
    }

    for (const trip of trips) {
      total += trip.total;
      for (const item of trip.items) {
        if (item.price === null || item.price === undefined) continue;
        const cat = item.category || 'Unknown';
        byCategory[cat] = (byCategory[cat] || 0) + item.price;
        addStoreAmount(item.storeId, item.storeName, item.price);
      }
    }

    const round = v => Math.round(v * 100) / 100;
    res.json({
      month: monthStr,
      total: round(total),
      byCategory: Object.entries(byCategory)
        .map(([name, amount]) => ({ name, amount: round(amount) }))
        .sort((a, b) => b.amount - a.amount),
      byStore: [...byStore.values()]
        .map(store => ({ ...store, amount: round(store.amount) }))
        .sort((a, b) => b.amount - a.amount)
    });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
