const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const PriceEntry = require('../models/PriceEntry');
const ShoppingListItem = require('../models/ShoppingListItem');
const InventoryItem = require('../models/InventoryItem');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

// ===== Name normalization + Levenshtein for duplicate detection =====

function _normName(name) {
  return name.toLowerCase().trim()
    .replace(/\s*[-–]\s*(lrg|large|sm|small|med|medium)\s*$/i, '')
    .replace(/s$/, '');
}

function _levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => j === 0 ? i : 0));
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Groups items into clusters where normalized names are within Levenshtein ≤ 3.
// Returns [{ canonical, duplicates }] — only groups with ≥ 2 members.
async function findDuplicateClusters(householdId) {
  const items = await Item.find({ householdId }).sort({ name: 1 }).lean();
  const used = new Set();
  const clusters = [];

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const normA = _normName(items[i].name);
    const group = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const normB = _normName(items[j].name);
      if (normA && normB && _levenshtein(normA, normB) <= 3) {
        group.push(items[j]);
        used.add(j);
      }
    }
    used.add(i);
    if (group.length > 1) {
      // Pick canonical: the one with the most price entries (fetch counts)
      const counts = await Promise.all(
        group.map(item => PriceEntry.countDocuments({ itemId: item._id, householdId }))
      );
      const canonicalIdx = counts.indexOf(Math.max(...counts));
      const canonical = group[canonicalIdx];
      const duplicates = group.filter((_, idx) => idx !== canonicalIdx);
      clusters.push({ canonical, duplicates });
    }
  }
  return clusters;
}

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
    res.status(500).json({ error: serverErr(err) });
  }
});

// GET /api/admin/duplicate-groups — preview similar-named items without merging
router.get('/duplicate-groups', requireAuth, requireAdmin, async (req, res) => {
  try {
    const clusters = await findDuplicateClusters(req.user.householdId);
    res.json(clusters);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/admin/consolidate-items — merge similar-named items permanently
// Body: { itemIds: [...] } to consolidate a specific set, or omit to consolidate all duplicates.
router.post('/consolidate-items', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { householdId } = req.user;
    let clusters;

    if (req.body.itemIds?.length >= 2) {
      // Consolidate a specific set of item IDs
      const items = await Item.find({ _id: { $in: req.body.itemIds }, householdId }).lean();
      if (items.length < 2) return res.status(400).json({ error: 'Need at least 2 items to consolidate' });
      const counts = await Promise.all(
        items.map(item => PriceEntry.countDocuments({ itemId: item._id, householdId }))
      );
      const canonicalIdx = counts.indexOf(Math.max(...counts));
      const canonical = items[canonicalIdx];
      const duplicates = items.filter((_, i) => i !== canonicalIdx);
      clusters = [{ canonical, duplicates }];
    } else {
      clusters = await findDuplicateClusters(householdId);
    }

    if (!clusters.length) return res.json({ merged: [], totalRemoved: 0 });

    const merged = [];
    for (const { canonical, duplicates } of clusters) {
      const dupIds = duplicates.map(d => d._id);
      await Promise.all([
        PriceEntry.updateMany({ itemId: { $in: dupIds }, householdId }, { itemId: canonical._id }),
        ShoppingListItem.updateMany({ itemId: { $in: dupIds }, householdId }, { itemId: canonical._id }),
        InventoryItem.updateMany({ itemId: { $in: dupIds }, householdId }, { itemId: canonical._id })
      ]);
      await Item.deleteMany({ _id: { $in: dupIds }, householdId });
      merged.push({ into: canonical.name, absorbed: duplicates.map(d => d.name) });
    }

    const totalRemoved = merged.reduce((sum, m) => sum + m.absorbed.length, 0);
    res.json({ merged, totalRemoved });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
