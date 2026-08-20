const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const MealPlan = require('../models/MealPlan');
const Household = require('../models/Household');
const HouseholdPerson = require('../models/HouseholdPerson');
const { ensureHouseholdPeople } = require('../utils/householdPeople');
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

async function validateAudienceScope(days, householdId) {
  if (!Array.isArray(days)) return true;

  const ids = [...new Set(days.flatMap(day =>
    (Array.isArray(day?.meals) ? day.meals : []).flatMap(meal =>
      Array.isArray(meal?.personIds) ? meal.personIds.map(String) : []
    )
  ))];

  if (!ids.length) return true;
  if (ids.some(id => !mongoose.isValidObjectId(id))) return false;

  const count = await HouseholdPerson.countDocuments({
    _id: { $in: ids },
    householdId
  });
  return count === ids.length;
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
    result.people = people;
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

    if (!(await validateAudienceScope(days, req.user.householdId))) {
      return res.status(400).json({ error: 'Meal audience contains a person outside this household' });
    }

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
