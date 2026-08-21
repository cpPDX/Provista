const express = require('express');
const router = express.Router();
const InventoryItem = require('../models/InventoryItem');
const Item = require('../models/Item');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
const STOCK_STATUSES = new Set(['have', 'low', 'out']);
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

function derivedStatus(item) {
  if (item.stockStatus && STOCK_STATUSES.has(item.stockStatus)) return item.stockStatus;
  if (Number(item.quantity) <= 0) return 'out';
  if (item.lowStockThreshold != null && Number(item.quantity) <= Number(item.lowStockThreshold)) return 'low';
  return 'have';
}

function publicInventoryItem(item) {
  return { ...item, stockStatus: derivedStatus(item) };
}

router.get('/low-stock', requireAuth, async (req, res) => {
  try {
    const items = await InventoryItem.find({ householdId: req.user.householdId })
      .populate('itemId', 'name brand unit size category isOrganic')
      .lean();
    const low = items
      .map(publicInventoryItem)
      .filter(item => item.stockStatus === 'low' || item.stockStatus === 'out' || (
        item.lowStockThreshold != null && Number(item.quantity) <= Number(item.lowStockThreshold)
      ));
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
    let quantity = req.body.quantity === undefined ? undefined : parseNonNegative(req.body.quantity, 'quantity');
    const threshold = lowStockThreshold === undefined || lowStockThreshold === null
      ? lowStockThreshold
      : parseNonNegative(lowStockThreshold, 'lowStockThreshold');
    if (requestedStatus === 'out') quantity = 0;
    if ((requestedStatus === 'have' || requestedStatus === 'low') && (quantity === undefined || quantity <= 0)) quantity = 1;

    const setFields = { lastUpdated: new Date(), lastUpdatedBy: req.user._id };
    if (quantity !== undefined) setFields.quantity = quantity;
    if (requestedStatus !== undefined) setFields.stockStatus = requestedStatus;
    else if (quantity !== undefined) {
      setFields.stockStatus = quantity <= 0
        ? 'out'
        : (threshold != null && quantity <= threshold ? 'low' : 'have');
    }
    if (unit !== undefined) setFields.unit = String(unit || '').trim();
    if (notes !== undefined) setFields.notes = String(notes || '').trim();
    if (lowStockThreshold !== undefined) setFields.lowStockThreshold = threshold;

    const insertFields = { householdId: req.user.householdId, itemId };
    if (quantity === undefined) insertFields.quantity = 1;
    if (setFields.stockStatus === undefined) insertFields.stockStatus = 'have';
    const inv = await InventoryItem.findOneAndUpdate(
      { householdId: req.user.householdId, itemId },
      { $set: setFields, $setOnInsert: insertFields },
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
    if (req.body.quantity !== undefined) inv.quantity = parseNonNegative(req.body.quantity, 'quantity');
    if (req.body.lowStockThreshold !== undefined) {
      inv.lowStockThreshold = req.body.lowStockThreshold === null
        ? null
        : parseNonNegative(req.body.lowStockThreshold, 'lowStockThreshold');
    }
    if (req.body.unit !== undefined) inv.unit = String(req.body.unit || '').trim();
    if (req.body.notes !== undefined) inv.notes = String(req.body.notes || '').trim();

    if (requestedStatus !== undefined) inv.stockStatus = requestedStatus;
    else if (req.body.quantity !== undefined || req.body.lowStockThreshold !== undefined) {
      inv.stockStatus = inv.quantity <= 0
        ? 'out'
        : (inv.lowStockThreshold != null && inv.quantity <= inv.lowStockThreshold ? 'low' : 'have');
    }
    if (inv.stockStatus === 'out') inv.quantity = 0;
    if ((inv.stockStatus === 'have' || inv.stockStatus === 'low') && inv.quantity <= 0) inv.quantity = 1;
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
