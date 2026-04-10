const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const Item = require('../models/Item');
const Store = require('../models/Store');
const PriceEntry = require('../models/PriceEntry');
const InventoryItem = require('../models/InventoryItem');
const ShoppingListItem = require('../models/ShoppingListItem');
const MealPlan = require('../models/MealPlan');
const User = require('../models/User');
const Household = require('../models/Household');

// GET /api/sync/bootstrap - returns all household data for offline cache population
router.get('/bootstrap', requireAuth, async (req, res) => {
  try {
    const hid = req.user.householdId;
    const now = new Date();

    // Current + previous month for spend cache
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Current + previous week for meal plan
    const household = await Household.findById(hid).select('weekStartDay name ownerId');
    const weekStartDay = household?.weekStartDay ?? 6;
    const todayDay = now.getUTCDay();
    const diff = (todayDay - weekStartDay + 7) % 7;
    const currentWeekStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - diff));
    currentWeekStart.setUTCHours(0, 0, 0, 0);
    const prevWeekStart = new Date(currentWeekStart);
    prevWeekStart.setUTCDate(prevWeekStart.getUTCDate() - 7);

    const [items, stores, priceEntries, inventory, shoppingList, mealPlans, spendEntries, members] = await Promise.all([
      Item.find({ householdId: hid }).lean(),
      Store.find({ householdId: hid }).lean(),
      PriceEntry.find({ householdId: hid })
        .populate('itemId', 'name category unit')
        .populate('storeId', 'name')
        .populate('submittedBy', 'name')
        .lean(),
      InventoryItem.find({ householdId: hid })
        .populate('itemId', 'name category unit')
        .lean(),
      ShoppingListItem.find({ householdId: hid })
        .populate('itemId', 'name category unit')
        .populate('addedBy', 'name')
        .sort({ checked: 1, addedAt: -1 })
        .lean(),
      MealPlan.find({
        householdId: hid,
        weekStart: { $in: [currentWeekStart, prevWeekStart] }
      }).lean(),
      PriceEntry.find({
        householdId: hid,
        status: 'approved',
        date: { $gte: prevMonthStart }
      }).lean(),
      User.find({ householdId: hid }).select('name role').lean()
    ]);

    // Build spend cache for current + previous month
    const spendCache = {};
    for (const entry of spendEntries) {
      const d = new Date(entry.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!spendCache[key]) spendCache[key] = { month: key, total: 0 };
      spendCache[key].total += entry.finalPrice;
    }
    // Round totals
    Object.values(spendCache).forEach(s => { s.total = Math.round(s.total * 100) / 100; });

    res.json({
      items,
      stores,
      priceEntries,
      inventory,
      shoppingList,
      mealPlan: mealPlans,
      spendCache: Object.values(spendCache),
      members,
      household: household ? { name: household.name, ownerId: household.ownerId } : null,
      metadata: {
        syncedAt: now.toISOString(),
        collections: ['items', 'stores', 'priceEntries', 'inventory', 'shoppingList', 'mealPlan', 'spendCache']
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
