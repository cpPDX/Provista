const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const { STORE_SECTIONS } = require('../models/Item');
const { requireAuth } = require('../middleware/auth');

// PUT /api/item-sections/:id - household members may correct the shopping
// department for an existing household catalog item. This is deliberately
// separate from admin-only product editing because section correction is a
// routine in-store action, not catalog administration.
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const storeSection = String(req.body?.storeSection || '').trim();
    if (!STORE_SECTIONS.includes(storeSection)) {
      return res.status(400).json({ error: 'Invalid store section' });
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
