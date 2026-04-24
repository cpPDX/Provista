const express = require('express');
const router = express.Router();
const MealPlan = require('../models/MealPlan');
const Household = require('../models/Household');
const User = require('../models/User');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'special'];

function buildScaffold(weekStart, members) {
  const days = [];
  const start = new Date(weekStart);
  const memberNames = (members || []).map(m => m.name);
  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + i);
    const meals = [];
    MEAL_TYPES.forEach(mealType => {
      if (memberNames.length === 0) {
        meals.push({ mealType, personName: '', name: '' });
      } else {
        memberNames.forEach(name => {
          meals.push({ mealType, personName: name, name: '' });
        });
      }
    });
    days.push({ date, meals, specialCollapsed: true });
  }
  return days;
}

// GET /api/meal-plan?weekStart=YYYY-MM-DD
router.get('/', requireAuth, async (req, res) => {
  try {
    const { weekStart } = req.query;
    if (!weekStart) return res.status(400).json({ error: 'weekStart query param required' });

    const weekStartDate = new Date(weekStart + 'T00:00:00.000Z');
    if (isNaN(weekStartDate.getTime())) return res.status(400).json({ error: 'Invalid weekStart date' });

    let plan = await MealPlan.findOne({ householdId: req.user.householdId, weekStart: weekStartDate });

    if (!plan) {
      const members = await User.find({ householdId: req.user.householdId }).select('name').lean();
      return res.json({
        householdId: req.user.householdId,
        weekStart: weekStartDate,
        days: buildScaffold(weekStartDate, members),
        produceNotes: '',
        shoppingNotes: '',
        _scaffold: true
      });
    }

    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// PUT /api/meal-plan
router.put('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { weekStart, days, produceNotes, shoppingNotes } = req.body;
    if (!weekStart) return res.status(400).json({ error: 'weekStart is required' });

    const weekStartDate = new Date(weekStart + 'T00:00:00.000Z');
    if (isNaN(weekStartDate.getTime())) return res.status(400).json({ error: 'Invalid weekStart date' });

    const plan = await MealPlan.findOneAndUpdate(
      { householdId: req.user.householdId, weekStart: weekStartDate },
      {
        $set: {
          days: days || buildScaffold(weekStartDate, []),
          produceNotes: produceNotes || '',
          shoppingNotes: shoppingNotes || ''
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// GET /api/meal-plan/settings
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const household = await Household.findById(req.user.householdId).select('weekStartDay');
    if (!household) return res.status(404).json({ error: 'Household not found' });
    res.json({ weekStartDay: household.weekStartDay });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// PUT /api/meal-plan/settings
router.put('/settings', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { weekStartDay } = req.body;
    if (![0, 1, 6].includes(weekStartDay)) {
      return res.status(400).json({ error: 'weekStartDay must be 0 (Sunday), 1 (Monday), or 6 (Saturday)' });
    }
    const household = await Household.findByIdAndUpdate(
      req.user.householdId,
      { weekStartDay },
      { new: true }
    ).select('weekStartDay');
    res.json({ weekStartDay: household.weekStartDay });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
