const express = require('express');
const router = express.Router();
const InventoryItem = require('../models/InventoryItem');
const Item = require('../models/Item');
const { requireAuth } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

function parseNonNegative(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return { error: `${field} must be a non-negative number` };
  return { value: parsed };
}

router.get('/low-stock', requireAuth, async (req, res) => {
  try {
    const items = await InventoryItem.find({
      householdId: req.user.householdId,
      lowStockThreshold: { $ne: null }
    }).populate('itemId', 'name brand unit size category isOrganic').lean();
    const low = items.filter(i => i.quantity <= i.lowStockThreshold);
    res.json(low);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    // Keep zero-quantity staples visible when the household has explicitly set a
    // low-stock threshold; Pantry is about what to keep on hand, not only what is
    // physically present right now.
    const items = await InventoryItem.find({
      householdId: req.user.householdId,
      $or: [
        { quantity: { $gt: 0 } },
        { lowStockThreshold: { $ne: null } }
      ]
    })
      .populate('itemId', 'name brand category unit size isOrganic')
      .sort({ updatedAt: -1 })
      .lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { itemId, quantity, unit, notes, lowStockThreshold } = req.body;
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });

    const item = await Item.findOne({ _id: itemId, householdId: req.user.householdId }).select('_id').lean();
    if (!item) return res.status(404).json({ error: 'Item not found in this household' });

    const setFields = { lastUpdated: new Date(), lastUpdatedBy: req.user._id };
    if (quantity !== undefined) {
      const result = parseNonNegative(quantity, 'quantity');
      if (result.error) return res.status(400).json({ error: result.error });
      setFields.quantity = result.value;
    }
    if (unit !== undefined) setFields.unit = String(unit || '').trim();
    if (notes !== undefined) setFields.notes = String(notes || '').trim();
    if (lowStockThreshold !== undefined) {
      if (lowStockThreshold === null || lowStockThreshold === '') {
        setFields.lowStockThreshold = null;
      } else {
        const result = parseNonNegative(lowStockThreshold, 'lowStockThreshold');
        if (result.error) return res.status(400).json({ error: result.error });
        setFields.lowStockThreshold = result.value;
      }
    }

    const inv = await InventoryItem.findOneAndUpdate(
      { householdId: req.user.householdId, itemId },
      { $set: setFields, $setOnInsert: { householdId: req.user.householdId, itemId } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
    ).populate('itemId', 'name brand category unit size isOrganic');
    res.status(201).json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const update = { lastUpdated: new Date(), lastUpdatedBy: req.user._id };

    if (Object.prototype.hasOwnProperty.call(req.body, 'quantity')) {
      const result = parseNonNegative(req.body.quantity, 'quantity');
      if (result.error) return res.status(400).json({ error: result.error });
      update.quantity = result.value;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'unit')) update.unit = String(req.body.unit || '').trim();
    if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) update.notes = String(req.body.notes || '').trim();
    if (Object.prototype.hasOwnProperty.call(req.body, 'lowStockThreshold')) {
      const value = req.body.lowStockThreshold;
      if (value === null || value === '') {
        update.lowStockThreshold = null;
      } else {
        const result = parseNonNegative(value, 'lowStockThreshold');
        if (result.error) return res.status(400).json({ error: result.error });
        update.lowStockThreshold = result.value;
      }
    }

    // itemId and householdId are relationship fields and deliberately cannot be
    // reassigned through the collaborative Pantry update endpoint.
    const supported = ['quantity', 'unit', 'notes', 'lowStockThreshold'];
    const hasSupportedField = supported.some(field => Object.prototype.hasOwnProperty.call(req.body, field));
    if (!hasSupportedField) return res.status(400).json({ error: 'No supported fields to update' });

    const inv = await InventoryItem.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      update,
      { new: true, runValidators: true }
    ).populate('itemId', 'name brand category unit size isOrganic');
    if (!inv) return res.status(404).json({ error: 'Inventory item not found' });
    res.json(inv);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const inv = await InventoryItem.findOneAndDelete({ _id: req.params.id, householdId: req.user.householdId });
    if (!inv) return res.status(404).json({ error: 'Inventory item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
