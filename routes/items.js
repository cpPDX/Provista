const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const PriceEntry = require('../models/PriceEntry');
const ShoppingListItem = require('../models/ShoppingListItem');
const InventoryItem = require('../models/InventoryItem');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { normalizeUpc } = require('../utils/upc');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

// GET /api/items - list or search items scoped to household
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    const query = { householdId: req.user.householdId };
    if (search && search.length >= 2) {
      const re = { $regex: search, $options: 'i' };
      query.$or = [{ name: re }, { brand: re }];
    }
    const items = await Item.find(query).sort({ name: 1 }).limit(search ? 8 : 0).lean();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/items - add a non-destructive household catalog entry (all roles)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, category, unit } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    if (!category || !category.trim()) return res.status(400).json({ error: 'category is required' });
    if (!unit || !unit.trim()) return res.status(400).json({ error: 'unit is required' });

    const itemData = {
      householdId: req.user.householdId,
      name,
      category,
      unit,
      brand: req.body.brand,
      size: req.body.size,
      barcode: req.body.barcode,
      upc: req.body.upc,
      upcSource: req.body.upcSource,
      upcPendingLookup: req.body.upcPendingLookup,
      isOrganic: req.body.isOrganic,
      isSeeded: false
    };
    Object.keys(itemData).forEach(key => itemData[key] === undefined && delete itemData[key]);
    if (itemData.upc) itemData.upc = normalizeUpc(String(itemData.upc)) ?? null;
    const item = new Item(itemData);
    await item.save();
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/items/:id - update item (admin+)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const updates = {};
    ['name', 'brand', 'category', 'unit', 'size', 'barcode', 'upc', 'upcSource', 'upcPendingLookup', 'isOrganic']
      .forEach(field => {
        if (req.body[field] !== undefined) updates[field] = req.body[field];
      });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });
    if (updates.upc !== undefined) {
      updates.upc = updates.upc ? (normalizeUpc(String(updates.upc)) ?? null) : null;
    }
    const item = await Item.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      updates,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/items/:id/merge - merge source item into target, re-pointing all references (admin+)
router.post('/:id/merge', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { targetId } = req.body;
    const sourceId = req.params.id;
    const householdId = req.user.householdId;
    if (!targetId || targetId === sourceId) return res.status(400).json({ error: 'Invalid targetId' });

    const [source, target] = await Promise.all([
      Item.findOne({ _id: sourceId, householdId }),
      Item.findOne({ _id: targetId, householdId })
    ]);
    if (!source || !target) return res.status(404).json({ error: 'Item not found' });

    // Re-point all references from source → target
    await Promise.all([
      PriceEntry.updateMany({ itemId: sourceId, householdId }, { itemId: targetId }),
      ShoppingListItem.updateMany({ itemId: sourceId, householdId }, { itemId: targetId }),
      InventoryItem.updateMany({ itemId: sourceId, householdId }, { itemId: targetId })
    ]);

    await Item.findOneAndDelete({ _id: sourceId, householdId });
    res.json({ success: true, target });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// DELETE /api/items/:id - delete item (admin+)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const item = await Item.findOneAndDelete({ _id: req.params.id, householdId: req.user.householdId });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
