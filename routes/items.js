const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const PriceEntry = require('../models/PriceEntry');
const ShoppingTrip = require('../models/ShoppingTrip');
const ShoppingListItem = require('../models/ShoppingListItem');
const InventoryItem = require('../models/InventoryItem');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { normalizeUpc } = require('../utils/upc');
const {
  MAX_MATCH_INPUT_LENGTH,
  MAX_MATCH_ITEMS,
  matchCatalogItem,
  parseShoppingText,
  stemShoppingText
} = require('../utils/itemMatching');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

function publicMatchItem(item) {
  if (!item) return null;
  return {
    _id: String(item._id),
    name: item.name,
    brand: item.brand || '',
    category: item.category,
    unit: item.unit,
    size: item.size || '',
    isOrganic: Boolean(item.isOrganic)
  };
}

function publicAlias(alias) {
  if (!alias) return null;
  return {
    _id: String(alias._id),
    text: alias.text,
    source: alias.source,
    confirmedAt: alias.confirmedAt
  };
}

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

    // Manage Products owns a durable last-purchased date. Use both approved
    // manual/price history and completed shopping trips so a purchase still
    // counts when its price was deferred.
    if (!search && items.length) {
      const itemIds = items.map(item => item._id);
      const [latestPrices, latestTrips] = await Promise.all([
        PriceEntry.aggregate([
          {
            $match: {
              householdId: req.user.householdId,
              itemId: { $in: itemIds },
              status: 'approved'
            }
          },
          { $group: { _id: '$itemId', lastPurchasedAt: { $max: '$date' } } }
        ]),
        ShoppingTrip.aggregate([
          {
            $match: {
              householdId: req.user.householdId,
              status: 'completed',
              'items.itemId': { $in: itemIds }
            }
          },
          { $unwind: '$items' },
          { $match: { 'items.itemId': { $in: itemIds } } },
          { $group: { _id: '$items.itemId', lastPurchasedAt: { $max: '$completedAt' } } }
        ])
      ]);

      const lastPurchasedByItem = new Map();
      for (const entry of [...latestPrices, ...latestTrips]) {
        const id = String(entry._id);
        const current = lastPurchasedByItem.get(id);
        if (!current || new Date(entry.lastPurchasedAt) > new Date(current)) {
          lastPurchasedByItem.set(id, entry.lastPurchasedAt);
        }
      }

      return res.json(items.map(item => ({
        ...item,
        lastPurchasedAt: lastPurchasedByItem.get(String(item._id)) || null
      })));
    }

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/items/match - parse grocery text and resolve it against the
// household catalog using the shared deterministic matcher. This endpoint is
// intentionally Pantry-agnostic so List, receipt, and future capture flows can
// share one matching contract.
router.post('/match', requireAuth, async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) return res.status(400).json({ error: 'text is required' });
    if (text.length > MAX_MATCH_INPUT_LENGTH) {
      return res.status(400).json({ error: `text must be ${MAX_MATCH_INPUT_LENGTH} characters or fewer` });
    }

    const rawFragments = text.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean);
    if (rawFragments.length > MAX_MATCH_ITEMS) {
      return res.status(400).json({ error: `No more than ${MAX_MATCH_ITEMS} items can be matched at once` });
    }

    const parsedItems = parseShoppingText(text);
    if (!parsedItems.length) {
      return res.status(400).json({ error: 'No grocery items could be parsed from that text' });
    }

    const householdId = req.user.householdId;
    const [items, usageRows] = await Promise.all([
      Item.find({ householdId })
        .select('name brand category unit size isOrganic aliases')
        .lean(),
      ShoppingTrip.aggregate([
        { $match: { householdId, status: 'completed' } },
        { $unwind: '$items' },
        { $group: { _id: '$items.itemId', usage: { $sum: 1 } } }
      ])
    ]);
    const usageByItemId = new Map(usageRows.map(row => [String(row._id), Number(row.usage) || 0]));
    const resolvedIds = new Set();

    const suggestions = parsedItems.map(parsed => {
      const match = matchCatalogItem(parsed, items, { usageByItemId });
      const candidates = match.candidates.map(candidate => ({
        ...publicMatchItem(candidate.item),
        score: candidate.score,
        matchSource: candidate.matchSource
      }));
      const item = match.matchStatus === 'matched' ? publicMatchItem(match.item) : null;
      const duplicateInInput = Boolean(item && resolvedIds.has(item._id));
      if (item) resolvedIds.add(item._id);

      return {
        ...parsed,
        matchStatus: match.matchStatus,
        confidenceScore: match.confidenceScore,
        confidenceGap: match.confidenceGap,
        matchSource: match.matchSource,
        matchedAlias: match.matchedAlias,
        duplicateInInput,
        item,
        candidates
      };
    });

    res.json({
      parsedCount: parsedItems.length,
      matchedCount: suggestions.filter(item => item.matchStatus === 'matched').length,
      ambiguousCount: suggestions.filter(item => item.matchStatus === 'ambiguous').length,
      unmatchedCount: suggestions.filter(item => item.matchStatus === 'unmatched').length,
      suggestions
    });
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

// POST /api/items/:id/aliases - persist a household-scoped alias only after a
// user has explicitly resolved the text to an existing catalog item.
router.post('/:id/aliases', requireAuth, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim().replace(/\s+/g, ' ');
    const source = String(req.body?.source || 'user-entry');
    if (!text) return res.status(400).json({ error: 'alias text is required' });
    if (text.length > 120) return res.status(400).json({ error: 'alias text must be 120 characters or fewer' });
    if (!['user-entry', 'receipt', 'import'].includes(source)) {
      return res.status(400).json({ error: 'Invalid alias source' });
    }

    const normalized = stemShoppingText(text);
    if (!normalized) return res.status(400).json({ error: 'alias text is invalid' });

    const householdId = req.user.householdId;
    const catalog = await Item.find({ householdId }).select('name aliases');
    const item = catalog.find(candidate => String(candidate._id) === String(req.params.id));
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (stemShoppingText(item.name) === normalized) {
      return res.json({ created: false, alias: null, item: publicMatchItem(item) });
    }

    const existing = item.aliases.find(alias => alias.normalized === normalized);
    if (existing) {
      return res.json({ created: false, alias: publicAlias(existing), item: publicMatchItem(item) });
    }

    const conflictingItem = catalog.find(candidate =>
      String(candidate._id) !== String(item._id) && (
        stemShoppingText(candidate.name) === normalized ||
        candidate.aliases.some(alias => alias.normalized === normalized)
      )
    );
    if (conflictingItem) {
      return res.status(409).json({
        error: `That text already identifies ${conflictingItem.name}. Remove or correct the existing mapping first.`
      });
    }

    item.aliases.push({
      text,
      normalized,
      source,
      confirmedBy: req.user._id,
      confirmedAt: new Date()
    });
    await item.save();
    const alias = item.aliases[item.aliases.length - 1];

    res.status(201).json({
      created: true,
      alias: publicAlias(alias),
      item: publicMatchItem(item)
    });
  } catch (err) {
    if (err?.name === 'CastError') return res.status(404).json({ error: 'Item not found' });
    if (err?.name === 'ValidationError') return res.status(400).json({ error: serverErr(err) });
    res.status(500).json({ error: serverErr(err) });
  }
});

// DELETE /api/items/:id/aliases/:aliasId - reversible correction path for a
// bad learned mapping. Alias identity remains attached to the catalog item and
// never creates a duplicate product.
router.delete('/:id/aliases/:aliasId', requireAuth, async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.id, householdId: req.user.householdId });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const alias = item.aliases.id(req.params.aliasId);
    if (!alias) return res.status(404).json({ error: 'Alias not found' });
    alias.deleteOne();
    await item.save();

    res.json({ success: true });
  } catch (err) {
    if (err?.name === 'CastError') return res.status(404).json({ error: 'Alias not found' });
    res.status(500).json({ error: serverErr(err) });
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
