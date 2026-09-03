const express = require('express');
const router = express.Router();
const Household = require('../models/Household');
const InventoryEvent = require('../models/InventoryEvent');
const InventoryItem = require('../models/InventoryItem');
const Item = require('../models/Item');
const { appendAbsoluteCount, ensureBaselineEvent } = require('../utils/inventoryLedger');
const { reconcileHouseholdMeals } = require('../utils/mealReconciliation');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
const STOCK_STATUSES = new Set(['have', 'low', 'out']);
const TRACKING_MODES = new Set(['simple', 'exact']);
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

function parseNonNegative(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const error = new Error(`${field} must be a non-negative number`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function effectiveTrackingMode(item) {
  if (item?.trackingMode === 'exact') return 'exact';
  if (item?.lowStockThreshold != null) return 'exact';
  return 'simple';
}

function derivedStatus(item) {
  if (effectiveTrackingMode(item) === 'exact') {
    if (Number(item.quantity) <= 0) return 'out';
    if (item.lowStockThreshold != null && Number(item.quantity) <= Number(item.lowStockThreshold)) return 'low';
    return 'have';
  }
  if (item.stockStatus && STOCK_STATUSES.has(item.stockStatus)) return item.stockStatus;
  return Number(item.quantity) <= 0 ? 'out' : 'have';
}

function publicInventoryItem(item) {
  return {
    ...item,
    trackingMode: effectiveTrackingMode(item),
    stockStatus: derivedStatus(item)
  };
}

function parseTrackingMode(value, fallback = 'simple') {
  if (value === undefined || value === null || value === '') return fallback;
  if (!TRACKING_MODES.has(value)) {
    const error = new Error('trackingMode must be simple or exact');
    error.status = 400;
    throw error;
  }
  return value;
}

function validTimeZone(value) {
  const timeZone = String(value || '').trim();
  if (!timeZone) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch (_) {
    return null;
  }
}

async function reconcileForRequest(req) {
  const household = await Household.findById(req.user.householdId).select('settings.timeZone');
  if (!household) return;

  const reportedTimeZone = validTimeZone(req.get('x-provista-timezone'));
  let timeZone = validTimeZone(household.settings?.timeZone);
  if (!timeZone && reportedTimeZone) {
    timeZone = reportedTimeZone;
    await Household.findByIdAndUpdate(req.user.householdId, { $set: { 'settings.timeZone': reportedTimeZone } });
  }
  // Older/offline clients may not have established a household timezone yet.
  // Do not guess with server time; reconciliation begins once a household-local
  // timezone has been captured by an authenticated client.
  if (!timeZone) return;

  await reconcileHouseholdMeals({ householdId: req.user.householdId, timeZone });
}

router.get('/low-stock', requireAuth, async (req, res) => {
  try {
    await reconcileForRequest(req);
    const items = await InventoryItem.find({ householdId: req.user.householdId })
      .populate('itemId', 'name brand unit size category isOrganic')
      .lean();
    const low = items
      .map(publicInventoryItem)
      .filter(item => item.stockStatus === 'low' || item.stockStatus === 'out');
    res.json(low);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const events = await InventoryEvent.find({ householdId: req.user.householdId })
      .populate('itemId', 'name brand unit')
      .sort({ effectiveAt: -1, recordedAt: -1, _id: -1 })
      .limit(200)
      .lean();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    await reconcileForRequest(req);
    const items = await InventoryItem.find({ householdId: req.user.householdId })
      .populate('itemId', 'name brand category unit size isOrganic')
      .sort({ lastUpdated: -1 })
      .lean();
    const priority = { out: 0, low: 1, have: 2 };
    res.json(items.map(publicInventoryItem).sort((a, b) => {
      const statusOrder = priority[a.stockStatus] - priority[b.stockStatus];
      if (statusOrder !== 0) return statusOrder;
      return new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0);
    }));
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { itemId, unit, notes, lowStockThreshold } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    if (!(await Item.exists({ _id: itemId, householdId: req.user.householdId }))) {
      return res.status(404).json({ error: 'Item not found in this household' });
    }

    const requestedStatus = req.body.stockStatus;
    if (requestedStatus !== undefined && !STOCK_STATUSES.has(requestedStatus)) {
      return res.status(400).json({ error: 'stockStatus must be have, low, or out' });
    }

    const legacyExactIntent = req.body.trackingMode === undefined &&
      requestedStatus === undefined &&
      (req.body.quantity !== undefined || lowStockThreshold !== undefined);
    const trackingMode = parseTrackingMode(req.body.trackingMode, legacyExactIntent ? 'exact' : 'simple');
    const threshold = lowStockThreshold === undefined || lowStockThreshold === null || lowStockThreshold === ''
      ? null
      : parseNonNegative(lowStockThreshold, 'lowStockThreshold');

    let quantity = req.body.quantity === undefined ? 1 : parseNonNegative(req.body.quantity, 'quantity');
    let stockStatus;
    let savedThreshold = threshold;

    if (trackingMode === 'exact') {
      if (requestedStatus !== undefined) {
        return res.status(400).json({ error: 'Exact tracking derives stock status from quantity and the low-stock threshold' });
      }
      stockStatus = quantity <= 0
        ? 'out'
        : (threshold != null && quantity <= threshold ? 'low' : 'have');
    } else {
      stockStatus = requestedStatus || 'have';
      savedThreshold = null;
      quantity = stockStatus === 'out' ? 0 : Math.max(quantity || 1, 1);
    }

    const setFields = {
      trackingMode,
      quantity,
      stockStatus,
      lowStockThreshold: savedThreshold,
      lastUpdated: new Date(),
      lastUpdatedBy: req.user._id
    };
    if (unit !== undefined) setFields.unit = String(unit || '').trim();
    if (notes !== undefined) setFields.notes = String(notes || '').trim();

    const inv = await InventoryItem.findOneAndUpdate(
      { householdId: req.user.householdId, itemId },
      {
        $set: setFields,
        $setOnInsert: { householdId: req.user.householdId, itemId }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    );

    if (trackingMode === 'exact') {
      await appendAbsoluteCount(inv, quantity, {
        sourceType: 'pantry-edit',
        createdBy: req.user._id
      });
    }

    await inv.populate('itemId', 'name brand category unit size isOrganic');
    res.status(201).json(publicInventoryItem(inv.toObject()));
  } catch (err) {
    res.status(err.status || 400).json({ error: serverErr(err) });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const inv = await InventoryItem.findOne({ _id: req.params.id, householdId: req.user.householdId });
    if (!inv) return res.status(404).json({ error: 'Pantry item not found' });

    const requestedStatus = req.body.stockStatus;
    if (requestedStatus !== undefined && !STOCK_STATUSES.has(requestedStatus)) {
      return res.status(400).json({ error: 'stockStatus must be have, low, or out' });
    }

    const currentMode = effectiveTrackingMode(inv);
    const legacyExactIntent = req.body.trackingMode === undefined &&
      requestedStatus === undefined &&
      (req.body.quantity !== undefined || req.body.lowStockThreshold !== undefined);
    const trackingMode = parseTrackingMode(req.body.trackingMode, legacyExactIntent ? 'exact' : currentMode);
    const switchingToSimple = currentMode !== 'simple' && trackingMode === 'simple';

    if (currentMode === 'exact') await ensureBaselineEvent(inv);
    if (req.body.unit !== undefined) inv.unit = String(req.body.unit || '').trim();
    if (req.body.notes !== undefined) inv.notes = String(req.body.notes || '').trim();

    let explicitExactQuantity = null;
    if (trackingMode === 'exact') {
      if (requestedStatus !== undefined) {
        return res.status(400).json({ error: 'Exact tracking derives stock status from quantity and the low-stock threshold' });
      }
      if (req.body.quantity !== undefined) {
        explicitExactQuantity = parseNonNegative(req.body.quantity, 'quantity');
        inv.quantity = explicitExactQuantity;
      }
      if (req.body.lowStockThreshold !== undefined) {
        inv.lowStockThreshold = req.body.lowStockThreshold === null || req.body.lowStockThreshold === ''
          ? null
          : parseNonNegative(req.body.lowStockThreshold, 'lowStockThreshold');
      }
      inv.trackingMode = 'exact';
      inv.stockStatus = inv.quantity <= 0
        ? 'out'
        : (inv.lowStockThreshold != null && inv.quantity <= inv.lowStockThreshold ? 'low' : 'have');
    } else {
      const nextStatus = requestedStatus || (switchingToSimple ? derivedStatus(inv) : inv.stockStatus) || 'have';
      inv.trackingMode = 'simple';
      inv.stockStatus = nextStatus;
      inv.lowStockThreshold = null;
      inv.quantity = nextStatus === 'out' ? 0 : Math.max(Number(inv.quantity) || 1, 1);
    }

    inv.lastUpdated = new Date();
    inv.lastUpdatedBy = req.user._id;
    await inv.save();

    if (trackingMode === 'exact' && explicitExactQuantity != null) {
      await appendAbsoluteCount(inv, explicitExactQuantity, {
        sourceType: 'pantry-edit',
        createdBy: req.user._id
      });
    }

    await inv.populate('itemId', 'name brand category unit size isOrganic');
    res.json(publicInventoryItem(inv.toObject()));
  } catch (err) {
    res.status(err.status || 400).json({ error: serverErr(err) });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const inv = await InventoryItem.findOneAndDelete({ _id: req.params.id, householdId: req.user.householdId });
    if (!inv) return res.status(404).json({ error: 'Pantry item not found' });
    await InventoryEvent.deleteMany({ householdId: req.user.householdId, inventoryItemId: inv._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
