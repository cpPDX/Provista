const express = require('express');
const router = express.Router();
const {
  reconciliationStatus,
  reverseMealConsumption,
  updatePantryFromCurrentMeal
} = require('../services/mealReconciliationActions');
const { requireAuth } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

router.get('/:mealInstanceId', requireAuth, async (req, res) => {
  try {
    res.json(await reconciliationStatus(req.user.householdId, req.params.mealInstanceId));
  } catch (err) {
    res.status(err.status || 500).json({ error: serverErr(err) });
  }
});

router.post('/:mealInstanceId/reverse', requireAuth, async (req, res) => {
  try {
    const result = await reverseMealConsumption({
      householdId: req.user.householdId,
      mealInstanceId: req.params.mealInstanceId,
      createdBy: req.user._id
    });
    res.json({ ...result, status: await reconciliationStatus(req.user.householdId, req.params.mealInstanceId) });
  } catch (err) {
    res.status(err.status || 500).json({ error: serverErr(err) });
  }
});

router.post('/:mealInstanceId/update-pantry', requireAuth, async (req, res) => {
  try {
    res.json(await updatePantryFromCurrentMeal({
      householdId: req.user.householdId,
      mealInstanceId: req.params.mealInstanceId,
      idempotencyKey: req.body?.idempotencyKey,
      createdBy: req.user._id
    }));
  } catch (err) {
    res.status(err.status || 500).json({
      error: serverErr(err),
      ...(err.unresolved ? { unresolved: err.unresolved } : {})
    });
  }
});

module.exports = router;
