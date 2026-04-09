const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Category normalization map — same as frontend csvImport.js
const CATEGORY_NORMALIZE = {
  'Dry': 'Pantry',
  'dry': 'Pantry',
  'Dry Goods': 'Pantry',
  'dry goods': 'Pantry',
  'Dried Goods': 'Pantry',
  'dried goods': 'Pantry',
  'Pantry Dry': 'Pantry',
  'pantry dry': 'Pantry',
  'Shelf Stable': 'Pantry',
  'shelf stable': 'Pantry',
  'Canned': 'Pantry',
  'canned': 'Pantry',
  'Canned Goods': 'Pantry',
  'canned goods': 'Pantry',
};

// POST /api/admin/migrate-categories
// One-time migration: remap "Dry" and other raw CSV categories to canonical names.
// Scoped to the requesting user's household. Idempotent — safe to run multiple times.
router.post('/migrate-categories', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { householdId } = req.user;
    const rawCategories = Object.keys(CATEGORY_NORMALIZE);
    const results = [];

    for (const raw of rawCategories) {
      const normalized = CATEGORY_NORMALIZE[raw];
      const result = await Item.updateMany(
        { householdId, category: raw },
        { $set: { category: normalized } }
      );
      if (result.modifiedCount > 0) {
        results.push({ from: raw, to: normalized, count: result.modifiedCount });
      }
    }

    const totalFixed = results.reduce((sum, r) => sum + r.count, 0);
    res.json({
      success: true,
      totalFixed,
      details: results,
      message: totalFixed > 0
        ? `Remapped ${totalFixed} item(s) to canonical category names.`
        : 'No items required category normalization.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
