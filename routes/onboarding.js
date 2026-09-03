const express = require('express');
const router = express.Router();
const Household = require('../models/Household');
const MealPlan = require('../models/MealPlan');
const ShoppingListItem = require('../models/ShoppingListItem');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/security');

// Onboarding writes are infrequent by design. Keep accidental retries and
// automated abuse bounded without limiting normal progress through the flow.
const onboardingMutationLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyPrefix: 'onboarding-write'
});

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

function initialOnboardingState() {
  const now = new Date();
  return {
    version: 1,
    status: 'in_progress',
    step: 'household',
    peopleSkipped: false,
    householdPeopleCompletedAt: null,
    householdPeopleSkippedAt: null,
    firstAction: null,
    firstActionSelectedAt: null,
    firstUsefulAction: null,
    firstUsefulActionAt: null,
    startedAt: now,
    lastSeenAt: now,
    lastResumedAt: null,
    resumeCount: 0,
    completedAt: null
  };
}

function publicState(household) {
  const onboarding = household?.onboarding;
  if (!onboarding) {
    return {
      required: false,
      version: null,
      status: 'completed',
      step: 'completed',
      peopleSkipped: false,
      firstAction: null,
      firstUsefulAction: null,
      startedAt: null,
      firstUsefulActionAt: null,
      completedAt: null,
      resumeCount: 0
    };
  }

  const state = typeof onboarding.toObject === 'function' ? onboarding.toObject() : onboarding;
  return {
    required: state.status !== 'completed',
    version: state.version || 1,
    status: state.status,
    step: state.step,
    peopleSkipped: Boolean(state.peopleSkipped),
    householdPeopleCompletedAt: state.householdPeopleCompletedAt || null,
    householdPeopleSkippedAt: state.householdPeopleSkippedAt || null,
    firstAction: state.firstAction || null,
    firstActionSelectedAt: state.firstActionSelectedAt || null,
    firstUsefulAction: state.firstUsefulAction || null,
    firstUsefulActionAt: state.firstUsefulActionAt || null,
    startedAt: state.startedAt || null,
    lastSeenAt: state.lastSeenAt || null,
    lastResumedAt: state.lastResumedAt || null,
    resumeCount: Number(state.resumeCount) || 0,
    completedAt: state.completedAt || null
  };
}

async function householdFor(req) {
  return Household.findById(req.user.householdId).select('onboarding createdAt');
}

// GET /api/onboarding - durable first-run state. Households that predate the
// action-based flow intentionally return required=false.
router.get('/', requireAuth, async (req, res) => {
  try {
    const household = await householdFor(req);
    if (!household) return res.status(404).json({ error: 'Household not found' });
    res.json(publicState(household));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/onboarding/start - converts the legacy first-run browser marker
// into server-backed progress. Existing households are not opted in unless
// the client explicitly identifies this as a new-household first run.
router.post('/start', onboardingMutationLimiter, requireAuth, requireAdmin, async (req, res) => {
  try {
    const household = await householdFor(req);
    if (!household) return res.status(404).json({ error: 'Household not found' });
    if (!household.onboarding) {
      household.onboarding = initialOnboardingState();
      await household.save();
    }
    res.json(publicState(household));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/onboarding/people-step - records completion/skip of the optional
// planning-person step. Person records themselves continue to use the normal
// HouseholdPerson API so onboarding never owns a second copy of that data.
router.post('/people-step', onboardingMutationLimiter, requireAuth, requireAdmin, async (req, res) => {
  try {
    const household = await householdFor(req);
    if (!household?.onboarding) return res.status(409).json({ error: 'Onboarding has not started' });
    if (household.onboarding.status === 'completed') return res.json(publicState(household));

    const now = new Date();
    const skipped = Boolean(req.body.skipped);
    household.onboarding.peopleSkipped = skipped;
    household.onboarding.householdPeopleCompletedAt = now;
    household.onboarding.householdPeopleSkippedAt = skipped ? now : null;
    household.onboarding.step = 'action';
    household.onboarding.lastSeenAt = now;
    await household.save();
    res.json(publicState(household));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/onboarding/action - selects the real product surface that must
// produce the first useful outcome. Re-selecting a different action resets the
// verification window but does not discard already-saved household setup.
router.post('/action', onboardingMutationLimiter, requireAuth, requireAdmin, async (req, res) => {
  try {
    const action = String(req.body.action || '');
    if (!['plan', 'list'].includes(action)) {
      return res.status(400).json({ error: 'action must be "plan" or "list"' });
    }

    const household = await householdFor(req);
    if (!household?.onboarding) return res.status(409).json({ error: 'Onboarding has not started' });
    if (household.onboarding.status === 'completed') return res.json(publicState(household));

    const now = new Date();
    if (household.onboarding.firstAction !== action) {
      household.onboarding.firstUsefulAction = null;
      household.onboarding.firstUsefulActionAt = null;
    }
    household.onboarding.firstAction = action;
    household.onboarding.firstActionSelectedAt = now;
    household.onboarding.step = 'first_action';
    household.onboarding.lastSeenAt = now;
    await household.save();
    res.json(publicState(household));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/onboarding/back - supports back navigation without losing the
// saved people/profile work. From a selected action it returns to the action
// chooser; from there it returns to household setup.
router.post('/back', onboardingMutationLimiter, requireAuth, requireAdmin, async (req, res) => {
  try {
    const household = await householdFor(req);
    if (!household?.onboarding) return res.status(409).json({ error: 'Onboarding has not started' });
    if (household.onboarding.status === 'completed') return res.json(publicState(household));

    if (household.onboarding.step === 'first_action') {
      household.onboarding.step = 'action';
      household.onboarding.firstAction = null;
      household.onboarding.firstActionSelectedAt = null;
    } else if (household.onboarding.step === 'action') {
      household.onboarding.step = 'household';
    }
    household.onboarding.lastSeenAt = new Date();
    await household.save();
    res.json(publicState(household));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/onboarding/resume - privacy-conscious instrumentation. The client
// calls this once per browser session for an already-started flow; no household
// content is captured.
router.post('/resume', onboardingMutationLimiter, requireAuth, async (req, res) => {
  try {
    const household = await householdFor(req);
    if (!household?.onboarding || household.onboarding.status === 'completed') {
      return res.json(publicState(household));
    }

    const now = new Date();
    household.onboarding.resumeCount = (Number(household.onboarding.resumeCount) || 0) + 1;
    household.onboarding.lastResumedAt = now;
    household.onboarding.lastSeenAt = now;
    await household.save();
    res.json(publicState(household));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

async function verifyPlanOutcome(householdId, selectedAt) {
  const candidates = await MealPlan.find({
    householdId,
    updatedAt: { $gte: selectedAt }
  }).select('days updatedAt').sort({ updatedAt: -1 }).limit(8).lean();

  return candidates.some(plan =>
    (Array.isArray(plan.days) ? plan.days : []).some(day =>
      (Array.isArray(day.meals) ? day.meals : []).some(meal => String(meal?.name || '').trim())
    )
  );
}

async function verifyListOutcome(householdId, selectedAt) {
  return Boolean(await ShoppingListItem.exists({
    householdId,
    addedAt: { $gte: selectedAt }
  }));
}

// POST /api/onboarding/complete-action - completion is server verified against
// a real Plan/List mutation after the action-selection timestamp. Pressing a
// navigation button alone can never complete onboarding.
router.post('/complete-action', onboardingMutationLimiter, requireAuth, requireAdmin, async (req, res) => {
  try {
    const household = await householdFor(req);
    if (!household?.onboarding) return res.status(409).json({ error: 'Onboarding has not started' });
    if (household.onboarding.status === 'completed') return res.json(publicState(household));

    const action = household.onboarding.firstAction;
    const selectedAt = household.onboarding.firstActionSelectedAt;
    if (!action || !selectedAt) {
      return res.status(409).json({ error: 'Choose a first action before completing onboarding' });
    }

    const verified = action === 'plan'
      ? await verifyPlanOutcome(req.user.householdId, selectedAt)
      : await verifyListOutcome(req.user.householdId, selectedAt);

    if (!verified) {
      return res.status(409).json({
        error: action === 'plan'
          ? 'Plan a meal before finishing onboarding'
          : 'Add a grocery before finishing onboarding'
      });
    }

    const now = new Date();
    household.onboarding.firstUsefulAction = action === 'plan' ? 'meal_planned' : 'list_item_added';
    household.onboarding.firstUsefulActionAt = now;
    household.onboarding.status = 'completed';
    household.onboarding.step = 'completed';
    household.onboarding.completedAt = now;
    household.onboarding.lastSeenAt = now;
    await household.save();
    res.json(publicState(household));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
