const express = require('express');
const router = express.Router();
const MealPlan = require('../models/MealPlan');
const ShoppingListItem = require('../models/ShoppingListItem');
const InventoryItem = require('../models/InventoryItem');
const PriceEntry = require('../models/PriceEntry');
const { requireAuth } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

function parseLocalDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const start = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, value: `${y}-${m}-${d}` };
}

// GET /api/home?date=YYYY-MM-DD
// Returns the small set of household facts the Home / Today screen needs.
router.get('/', requireAuth, async (req, res) => {
  try {
    const parsed = parseLocalDate(req.query.date);
    if (!parsed) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

    const householdId = req.user.householdId;
    const [plan, shoppingCount, inventoryItems, frequent] = await Promise.all([
      MealPlan.findOne({
        householdId,
        'days.date': { $gte: parsed.start, $lt: parsed.end }
      }).lean(),
      ShoppingListItem.countDocuments({ householdId, checked: false }),
      InventoryItem.find({
        householdId,
        lowStockThreshold: { $ne: null }
      }).populate('itemId', 'name brand unit category').lean(),
      PriceEntry.aggregate([
        { $match: { householdId, status: 'approved' } },
        { $sort: { date: -1 } },
        { $limit: 500 },
        { $group: { _id: '$itemId', purchases: { $sum: 1 }, lastPurchased: { $max: '$date' } } },
        { $sort: { purchases: -1, lastPurchased: -1 } },
        { $limit: 6 },
        { $lookup: { from: 'items', localField: '_id', foreignField: '_id', as: 'item' } },
        { $unwind: '$item' },
        { $project: { _id: 0, itemId: '$item._id', name: '$item.name', unit: '$item.unit', purchases: 1 } }
      ])
    ]);

    const today = plan?.days?.find(day => {
      if (!day.date) return false;
      const date = new Date(day.date);
      return date >= parsed.start && date < parsed.end;
    });

    const dinnerMeals = (today?.meals || [])
      .filter(meal => meal.mealType === 'dinner' && String(meal.name || '').trim())
      .map(meal => ({
        name: String(meal.name).trim(),
        notes: String(meal.notes || '').trim(),
        forEveryone: meal.forEveryone !== false
      }));

    const lowStock = inventoryItems
      .filter(item => item.quantity <= item.lowStockThreshold)
      .map(item => ({
        inventoryId: item._id,
        itemId: item.itemId?._id || item.itemId,
        name: item.itemId?.name || 'Unknown item',
        quantity: item.quantity,
        threshold: item.lowStockThreshold,
        unit: item.unit || item.itemId?.unit || ''
      }));

    let nextAction;
    if (!dinnerMeals.length) {
      nextAction = { tab: 'meal-plan', label: 'Plan dinner', detail: 'Add tonight’s dinner so the rest of the household can see it.' };
    } else if (shoppingCount > 0) {
      nextAction = { tab: 'list', label: `Shop ${shoppingCount} item${shoppingCount === 1 ? '' : 's'}`, detail: 'Your shopping list is ready.' };
    } else if (lowStock.length > 0) {
      nextAction = { tab: 'inventory', label: `Review ${lowStock.length} low-stock item${lowStock.length === 1 ? '' : 's'}`, detail: 'Add staples to the list before they run out.' };
    } else {
      nextAction = { tab: null, label: 'You’re caught up', detail: 'Nothing urgent needs attention right now.' };
    }

    res.json({
      date: parsed.value,
      dinner: dinnerMeals,
      shoppingCount,
      lowStock,
      nextAction,
      frequentItems: frequent
    });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
