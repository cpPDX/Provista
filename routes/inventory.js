const express = require('express');
const router = express.Router();
const InventoryItem = require('../models/InventoryItem');
const Item = require('../models/Item');
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
  // Existing Pantry rows predate trackingMode. A saved threshold is strong evidence
  // that the household was already using exact tracking, so preserve that behavior.
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

router.get('/low-stock', requireAuth, async (req, res) => {
  try {
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

router.get('/', requireAuth, async (req, res) => {
  try {
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

// Routine Pantry changes are household collaboration, not administration.
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

    const inferredMode = req.body.trackingMode === undefined && lowStockThreshold !== undefined
      ? 'exact'
      : 'simple';
    const trackingMode = parseTrackingMode(req.body.trackingMode, inferredMode);
    const threshold = lowStockThreshold === undefined || lowStockThreshold === null || lowStockThreshold === ''
      ? null
      : parseNonNegative(lowStockThreshold, 'lowStockThreshold');

    let quantity = req.body.quantity === undefined ? 1 : parseNonNegative(req.body.quantity, 'quantity');
    let stockStatus;
    let savedThreshold = threshold;

    if (trackingMode === 'exact') {
      stockStatus = quantity <= 0
        ? 'out'
        : (threshold != null && quantity <= threshold ? 'low' : 'have');
    } else {
      stockStatus = requestedStatus || 'have';
      savedThreshold = null;
      // Quantity is an implementation detail in simple mode. Keep only a minimal
      // compatible value so shopping-trip replenishment can operate safely.
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
    ).populate('itemId', 'name brand category unit size isOrganic');

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
    const trackingMode = parseTrackingMode(req.body.trackingMode, currentMode);
    const switchingToSimple = currentMode !== 'simple' && trackingMode === 'simple';

    if (req.body.unit !== undefined) inv.unit = String(req.body.unit || '').trim();
    if (req.body.notes !== undefined) inv.notes = String(req.body.notes || '').trim();

    if (trackingMode === 'exact') {
      if (requestedStatus !== undefined && req.body.trackingMode !== 'exact') {
        return res.status(400).json({ error: 'Exact tracking derives stock status from quantity and the low-stock threshold' });
      }
      if (req.body.quantity !== undefined) inv.quantity = parseNonNegative(req.body.quantity, 'quantity');
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
      // Exact quantity is no longer user-maintained in simple mode.
      inv.quantity = nextStatus === 'out' ? 0 : Math.max(Number(inv.quantity) || 1, 1);
    }

    inv.lastUpdated = new Date();
    inv.lastUpdatedBy = req.user._id;
    await inv.save();
    await inv.populate('itemId', 'name brand category unit size isOrganic');
    res.json(publicInventoryItem(inv.toObject()));
  } catch (err) {
    res.status(err.status || 400).json({ error: serverErr(err) });
  }
});

// Removing the Pantry record entirely remains an administrative catalog action.
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const inv = await InventoryItem.findOneAndDelete({ _id: req.params.id, householdId: req.user.householdId });
    if (!inv) return res.status(404).json({ error: 'Pantry item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
