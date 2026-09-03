const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const { STORE_SECTIONS } = require('../models/Item');
const { requireAuth } = require('../middleware/auth');

function normalizeSection(value) {
  return String(value || '').trim();
}

// GET /api/item-sections - familiar defaults plus household-confirmed values.
// Custom values are returned as reusable suggestions without rewriting them.
router.get('/', requireAuth, async (req, res) => {
  try {
    const saved = await Item.find({
      householdId: req.user.householdId,
      storeSection: { $nin: [null, ''] }
    })
      .select('_id storeSection')
      .sort({ updatedAt: -1 })
      .lean();

    const custom = [...new Set(saved
      .map(item => normalizeSection(item.storeSection))
      .filter(section => section && !STORE_SECTIONS.includes(section)))]
      .sort((left, right) => left.localeCompare(right));

    res.json({
      defaults: STORE_SECTIONS,
      suggestions: [...STORE_SECTIONS, ...custom],
      saved: saved.map(item => ({ itemId: String(item._id), storeSection: normalizeSection(item.storeSection) }))
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/item-sections/:id - household members may correct the shopping
// department for an existing household catalog item. This is deliberately
// separate from admin-only product editing because section correction is a
// routine in-store action, not catalog administration.
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const storeSection = normalizeSection(req.body?.storeSection);
    if (!storeSection) {
      return res.status(400).json({ error: 'Store section is required' });
    }
    if (storeSection.length > 80) {
      return res.status(400).json({ error: 'Store section must be 80 characters or fewer' });
    }

    const item = await Item.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      { $set: { storeSection } },
      { new: true, runValidators: true }
    ).select('name category storeSection');

    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    if (err?.name === 'CastError') return res.status(404).json({ error: 'Item not found' });
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
