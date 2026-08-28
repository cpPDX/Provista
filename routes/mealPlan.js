const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const MealPlan = require('../models/MealPlan');
const FavoriteMeal = require('../models/FavoriteMeal');
const Household = require('../models/Household');
const HouseholdPerson = require('../models/HouseholdPerson');
const InventoryItem = require('../models/InventoryItem');
const Item = require('../models/Item');
const PriceEntry = require('../models/PriceEntry');
const ShoppingListItem = require('../models/ShoppingListItem');
const { ensureHouseholdPeople } = require('../utils/householdPeople');
const { buildMealShoppingSuggestions, MAX_NOTES_LENGTH } = require('../utils/mealShopping');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'special'];

function buildScaffold(weekStart) {
  const days = [];
  const start = new Date(weekStart);
  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const meals = MEAL_TYPES.map(mealType => ({
      mealType,
      personName: '',
      personIds: [],
      forEveryone: true,
      name: '',
      notes: ''
    }));
    days.push({ date, meals, specialCollapsed: true });
  }
  return days;
}

function normalizeFavoriteName(name) {
  return String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function copyDaysToWeek(sourceDays, weekStartDate) {
  const scaffold = buildScaffold(weekStartDate);
  return scaffold.map((targetDay, index) => {
    const sourceDay = Array.isArray(sourceDays) ? sourceDays[index] : null;
    if (!sourceDay) return targetDay;
    return {
      date: targetDay.date,
      specialCollapsed: sourceDay.specialCollapsed !== false,
      meals: Array.isArray(sourceDay.meals) && sourceDay.meals.length
        ? sourceDay.meals.map(meal => ({
          mealType: meal.mealType,
          personName: meal.personName || '',
          personIds: Array.isArray(meal.personIds) ? meal.personIds : [],
          forEveryone: meal.forEveryone,
          name: meal.name || '',
          notes: meal.notes || ''
        }))
        : targetDay.meals
    };
  });
}

function collectAudienceIds(days) {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.flatMap(day =>
    (Array.isArray(day?.meals) ? day.meals : []).flatMap(meal =>
      Array.isArray(meal?.personIds) ? meal.personIds.map(String) : []
    )
  ))];
}

async function validateAudience(days, householdId) {
  if (!Array.isArray(days)) return null;

  for (const day of days) {
    for (const meal of (Array.isArray(day?.meals) ? day.meals : [])) {
      const ids = Array.isArray(meal?.personIds) ? meal.personIds.filter(Boolean).map(String) : [];
      const legacyName = String(meal?.personName || '').trim();
      if (meal?.forEveryone === false && ids.length === 0 && !legacyName) {
        return 'A meal for selected people must include at least one person';
      }
    }
  }

  const ids = collectAudienceIds(days);
  if (!ids.length) return null;
  if (ids.some(id => !mongoose.isValidObjectId(id))) {
    return 'Meal audience contains an invalid household person';
  }

  const count = await HouseholdPerson.countDocuments({
    _id: { $in: ids },
    householdId
  });
  return count === ids.length ? null : 'Meal audience contains a person outside this household';
}

// GET /api/meal-plan?weekStart=YYYY-MM-DD
router.get('/', requireAuth, async (req, res) => {
  try {
    const { weekStart } = req.query;
    if (!weekStart) return res.status(400).json({ error: 'weekStart query param required' });

    const weekStartDate = new Date(weekStart + 'T00:00:00.000Z');
    if (isNaN(weekStartDate.getTime())) return res.status(400).json({ error: 'Invalid weekStart date' });

    const [plan, people] = await Promise.all([
      MealPlan.findOne({ householdId: req.user.householdId, weekStart: weekStartDate }),
      ensureHouseholdPeople(req.user.householdId)
    ]);

    if (!plan) {
      return res.json({
        householdId: req.user.householdId,
        weekStart: weekStartDate,
        days: buildScaffold(weekStartDate),
        people,
        produceNotes: '',
        shoppingNotes: '',
        _scaffold: true
      });
    }

    const result = plan.toObject();
    const activeIds = new Set(people.map(person => String(person._id)));
    const referencedIds = collectAudienceIds(result.days)
      .filter(id => mongoose.isValidObjectId(id) && !activeIds.has(id));
    const historicalPeople = referencedIds.length
      ? await HouseholdPerson.find({ _id: { $in: referencedIds }, householdId: req.user.householdId }).lean()
      : [];
    result.people = [
      ...people,
      ...historicalPeople.map(person => ({ ...person, historical: person.active === false }))
    ];
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// PUT /api/meal-plan
router.put('/', requireAuth, async (req, res) => {
  try {
    const { weekStart, days, produceNotes, shoppingNotes } = req.body;
    if (!weekStart) return res.status(400).json({ error: 'weekStart is required' });

    const weekStartDate = new Date(weekStart + 'T00:00:00.000Z');
    if (isNaN(weekStartDate.getTime())) return res.status(400).json({ error: 'Invalid weekStart date' });

    const audienceError = await validateAudience(days, req.user.householdId);
    if (audienceError) return res.status(400).json({ error: audienceError });

    const plan = await MealPlan.findOneAndUpdate(
      { householdId: req.user.householdId, weekStart: weekStartDate },
      {
        $set: {
          days: days || buildScaffold(weekStartDate),
          produceNotes: produceNotes || '',
          shoppingNotes: shoppingNotes || ''
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    res.json(plan);
  } catch (err) {
    if (err?.name === 'ValidationError' || err?.name === 'CastError') {
      return res.status(400).json({ error: serverErr(err) });
    }
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/meal-plan/shopping-suggestions
// Parse one meal's notes and preview household-scoped catalog matches before
// anything is added to the shopping list. Exact Pantry items are projected
// through the meal quantity so threshold crossings can be surfaced before use.
router.post('/shopping-suggestions', requireAuth, async (req, res) => {
  try {
    const { notes } = req.body;
    if (typeof notes !== 'string') return res.status(400).json({ error: 'notes must be a string' });
    if (notes.length > MAX_NOTES_LENGTH) {
      return res.status(400).json({ error: `notes must be ${MAX_NOTES_LENGTH} characters or fewer` });
    }

    const householdId = req.user.householdId;
    const [items, listItems, inventoryItems, priceUsage] = await Promise.all([
      Item.find({ householdId }).select('name brand category unit').lean(),
      ShoppingListItem.find({ householdId }).select('itemId').lean(),
      InventoryItem.find({ householdId })
        .select('itemId quantity trackingMode stockStatus lowStockThreshold')
        .lean(),
      PriceEntry.aggregate([
        { $match: { householdId } },
        { $group: { _id: '$itemId', count: { $sum: 1 } } }
      ])
    ]);

    const usageByItemId = new Map(priceUsage.map(entry => [String(entry._id), entry.count]));
    listItems.forEach(entry => {
      const id = String(entry.itemId);
      usageByItemId.set(id, (usageByItemId.get(id) || 0) + 5);
    });
    inventoryItems.forEach(entry => {
      const id = String(entry.itemId);
      usageByItemId.set(id, (usageByItemId.get(id) || 0) + 3);
    });

    res.json(buildMealShoppingSuggestions({ notes, items, listItems, inventoryItems, usageByItemId }));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/meal-plan/copy-previous - replace the requested week with the
// household's prior week while remapping each day to the new calendar dates.
router.post('/copy-previous', requireAuth, async (req, res) => {
  try {
    const { weekStart } = req.body;
    if (!weekStart) return res.status(400).json({ error: 'weekStart is required' });
    const weekStartDate = new Date(`${weekStart}T00:00:00.000Z`);
    if (isNaN(weekStartDate.getTime())) return res.status(400).json({ error: 'Invalid weekStart date' });

    const previousWeekStart = new Date(weekStartDate);
    previousWeekStart.setUTCDate(previousWeekStart.getUTCDate() - 7);
    const previous = await MealPlan.findOne({
      householdId: req.user.householdId,
      weekStart: previousWeekStart
    }).lean();
    if (!previous) return res.status(404).json({ error: 'No meal plan found for last week' });

    const copied = await MealPlan.findOneAndUpdate(
      { householdId: req.user.householdId, weekStart: weekStartDate },
      {
        $set: {
          days: copyDaysToWeek(previous.days, weekStartDate),
          produceNotes: previous.produceNotes || '',
          shoppingNotes: previous.shoppingNotes || ''
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    res.json(copied);
  } catch (err) {
    if (err?.name === 'ValidationError' || err?.name === 'CastError') {
      return res.status(400).json({ error: serverErr(err) });
    }
    res.status(500).json({ error: serverErr(err) });
  }
});

router.get('/favorites', requireAuth, async (req, res) => {
  try {
    const favorites = await FavoriteMeal.find({ householdId: req.user.householdId })
      .sort({ useCount: -1, lastUsedAt: -1, name: 1 })
      .lean();
    res.json(favorites);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.post('/favorites', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    const notes = String(req.body.notes || '').trim();
    if (!name) return res.status(400).json({ error: 'Favorite meal name is required' });
    if (name.length > 120) return res.status(400).json({ error: 'Favorite meal name is too long' });
    if (notes.length > 2000) return res.status(400).json({ error: 'Favorite meal notes are too long' });

    const favorite = await FavoriteMeal.findOneAndUpdate(
      { householdId: req.user.householdId, normalizedName: normalizeFavoriteName(name) },
      {
        $set: { name, notes },
        $setOnInsert: {
          householdId: req.user.householdId,
          normalizedName: normalizeFavoriteName(name),
          createdBy: req.user._id,
          useCount: 0,
          lastUsedAt: new Date()
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );
    res.json(favorite);
  } catch (err) {
    if (err?.name === 'ValidationError') return res.status(400).json({ error: serverErr(err) });
    res.status(500).json({ error: serverErr(err) });
  }
});

router.put('/favorites/:id', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    const notes = String(req.body.notes || '').trim();
    if (!name) return res.status(400).json({ error: 'Favorite meal name is required' });
    if (name.length > 120) return res.status(400).json({ error: 'Favorite meal name is too long' });
    if (notes.length > 2000) return res.status(400).json({ error: 'Favorite meal notes are too long' });

    const favorite = await FavoriteMeal.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      { $set: { name, normalizedName: normalizeFavoriteName(name), notes } },
      { new: true, runValidators: true }
    );
    if (!favorite) return res.status(404).json({ error: 'Favorite meal not found' });
    res.json(favorite);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'A favorite meal with that name already exists' });
    }
    if (err?.name === 'CastError') return res.status(404).json({ error: 'Favorite meal not found' });
    if (err?.name === 'ValidationError') return res.status(400).json({ error: serverErr(err) });
    res.status(500).json({ error: serverErr(err) });
  }
});

router.post('/favorites/:id/use', requireAuth, async (req, res) => {
  try {
    const favorite = await FavoriteMeal.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      { $inc: { useCount: 1 }, $set: { lastUsedAt: new Date() } },
      { new: true }
    );
    if (!favorite) return res.status(404).json({ error: 'Favorite meal not found' });
    res.json(favorite);
  } catch (err) {
    if (err?.name === 'CastError') return res.status(404).json({ error: 'Favorite meal not found' });
    res.status(500).json({ error: serverErr(err) });
  }
});

router.delete('/favorites/:id', requireAuth, async (req, res) => {
  try {
    const favorite = await FavoriteMeal.findOneAndDelete({
      _id: req.params.id,
      householdId: req.user.householdId
    });
    if (!favorite) return res.status(404).json({ error: 'Favorite meal not found' });
    res.json({ success: true });
  } catch (err) {
    if (err?.name === 'CastError') return res.status(404).json({ error: 'Favorite meal not found' });
    res.status(500).json({ error: serverErr(err) });
  }
});

// GET /api/meal-plan/settings
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const household = await Household.findById(req.user.householdId).select('weekStartDay mealPlanMode');
    if (!household) return res.status(404).json({ error: 'Household not found' });
    res.json({
      weekStartDay: household.weekStartDay,
      mealPlanMode: household.mealPlanMode || 'dinner'
    });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// PUT /api/meal-plan/settings
router.put('/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { weekStartDay, mealPlanMode } = req.body;
    const update = {};
    if (weekStartDay !== undefined && ![0, 1, 6].includes(weekStartDay)) {
      return res.status(400).json({ error: 'weekStartDay must be 0 (Sunday), 1 (Monday), or 6 (Saturday)' });
    }
    if (mealPlanMode !== undefined && !['dinner', 'all'].includes(mealPlanMode)) {
      return res.status(400).json({ error: 'mealPlanMode must be "dinner" or "all"' });
    }
    if (weekStartDay !== undefined) update.weekStartDay = weekStartDay;
    if (mealPlanMode !== undefined) update.mealPlanMode = mealPlanMode;
    if (!Object.keys(update).length) return res.status(400).json({ error: 'No valid settings provided' });
    const household = await Household.findByIdAndUpdate(
      req.user.householdId,
      { $set: update },
      { new: true }
    ).select('weekStartDay mealPlanMode');
    res.json({
      weekStartDay: household.weekStartDay,
      mealPlanMode: household.mealPlanMode || 'dinner'
    });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;