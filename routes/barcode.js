const express = require('express');
const https = require('https');
const router = express.Router();
const Item = require('../models/Item');
const Household = require('../models/Household');
const { requireAuth } = require('../middleware/auth');
const { normalizeUpc } = require('../utils/upc');
const { mapCategory } = require('../utils/categoryMap');

const OFF_TIMEOUT_MS = 5000;

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

function publicItem(item) {
  if (!item) return null;
  return {
    _id: item._id,
    upc: item.upc,
    name: item.name,
    brand: item.brand,
    category: item.category,
    unit: item.unit,
    size: item.size,
    isOrganic: item.isOrganic
  };
}

// GET /api/barcode/:upc
router.get('/:upc', requireAuth, async (req, res) => {
  const upc = normalizeUpc(req.params.upc);
  if (!upc) return res.status(400).json({ error: 'Invalid UPC format' });

  try {
    // Household catalog is always the source of truth for a known UPC. External
    // metadata can be requested separately to fill blanks, but never delays or
    // overwrites this authoritative match.
    const existing = await Item.findOne({ upc, householdId: req.user.householdId });
    if (existing) {
      const enrichableFields = [];
      if (!String(existing.brand || '').trim()) enrichableFields.push('brand');
      if (existing.size == null) enrichableFields.push('size');
      return res.json({
        found: true,
        source: 'local',
        confidence: 'full',
        autoAccept: true,
        item: publicItem(existing),
        missingFields: [],
        enrichableFields
      });
    }

    // Fall back to Open Food Facts for a new household product.
    let offProduct = null;
    try {
      offProduct = await fetchOffProduct(upc);
    } catch (err) {
      console.error(`Open Food Facts lookup failed for UPC ${upc}:`, err.message);
    }

    if (!offProduct) {
      return res.json({
        found: false,
        source: null,
        confidence: null,
        autoAccept: false,
        item: { upc },
        missingFields: ['name', 'category', 'unit'],
        enrichableFields: []
      });
    }

    const normalized = normalizeOffProduct(offProduct, upc);
    const missingFields = ['name', 'category', 'unit'].filter(f => !normalized[f]);
    const confidence = missingFields.length === 0 ? 'full' : 'partial';
    const autoAccept = await resolveAutoAccept(req.user);

    return res.json({
      found: true,
      source: 'openFoodFacts',
      confidence,
      autoAccept,
      item: normalized,
      missingFields,
      enrichableFields: []
    });
  } catch (err) {
    console.error('Barcode lookup error:', err);
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/barcode/:upc/enrich-local
// Safely improve an already-known household item without changing any field the
// household has populated. This intentionally fills only fields whose empty
// state is unambiguous; false/Other/each may be deliberate corrections.
router.post('/:upc/enrich-local', requireAuth, async (req, res) => {
  const upc = normalizeUpc(req.params.upc);
  if (!upc) return res.status(400).json({ error: 'Invalid UPC format' });

  try {
    const existing = await Item.findOne({ upc, householdId: req.user.householdId });
    if (!existing) return res.status(404).json({ error: 'Item not found' });

    const needsBrand = !String(existing.brand || '').trim();
    const needsSize = existing.size == null;
    if (!needsBrand && !needsSize) {
      return res.json({ item: publicItem(existing), filledFields: [] });
    }

    let offProduct = null;
    try {
      offProduct = await fetchOffProduct(upc);
    } catch (err) {
      console.info(`Open Food Facts enrichment unavailable for UPC ${upc}:`, err.message);
    }
    if (!offProduct) return res.json({ item: publicItem(existing), filledFields: [] });

    const normalized = normalizeOffProduct(offProduct, upc);
    const updates = {};
    const filledFields = [];
    if (needsBrand && normalized.brand) {
      updates.brand = normalized.brand;
      filledFields.push('brand');
    }
    if (needsSize && normalized.size != null) {
      updates.size = normalized.size;
      filledFields.push('size');
    }

    if (!filledFields.length) return res.json({ item: publicItem(existing), filledFields: [] });
    const updated = await Item.findOneAndUpdate(
      { _id: existing._id, householdId: req.user.householdId },
      { $set: updates },
      { new: true, runValidators: true }
    );
    return res.json({ item: publicItem(updated), filledFields });
  } catch (err) {
    console.error('Barcode enrichment error:', err);
    res.status(500).json({ error: serverErr(err) });
  }
});

function fetchOffProduct(upc) {
  return new Promise((resolve, reject) => {
    const url = `https://world.openfoodfacts.org/api/v0/product/${upc}.json`;
    const req = https.get(url, { timeout: OFF_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.status === 0 || !data.product) return resolve(null);
          resolve(data.product);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', (err) => reject(err));
  });
}

// Maps common unit strings from OFF's quantity field to canonical units
const UNIT_MAP = [
  { pattern: /\bfl\.?\s*oz\b/i, unit: 'fl oz' },
  { pattern: /\bkg\b|\bkilograms?\b/i, unit: 'kg' },
  { pattern: /\bg\b|\bgrams?\b/i, unit: 'g' },
  { pattern: /\blbs?\b|\bpounds?\b/i, unit: 'lb' },
  { pattern: /\boz\b|\bounces?\b/i, unit: 'oz' },
  { pattern: /\bml\b|\bmilliliters?\b/i, unit: 'ml' },
  { pattern: /\bl\b|\bliters?\b|\blitres?\b/i, unit: 'l' },
  { pattern: /\bct\b|\bcount\b|\beach\b/i, unit: 'ct' }
];

function parseUnit(quantity) {
  if (!quantity) return null;
  for (const { pattern, unit } of UNIT_MAP) {
    if (pattern.test(quantity)) return unit;
  }
  return null;
}

function parseSize(quantity) {
  if (!quantity) return null;
  const match = quantity.match(/([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}

function normalizeOffProduct(product, upc) {
  const name = (product.product_name_en || product.product_name || '').trim() || null;
  const brand = product.brands ? product.brands.split(',')[0].trim() : '';
  const isOrganic = Array.isArray(product.labels_tags) && product.labels_tags.includes('en:organic');
  const category = mapCategory(product.categories_tags);
  const unit = parseUnit(product.quantity);
  const size = parseSize(product.quantity);

  return { upc, name, brand, size, category, unit, isOrganic };
}

async function resolveAutoAccept(user) {
  if (user.preferences?.barcodeAutoAccept !== null && user.preferences?.barcodeAutoAccept !== undefined) {
    return user.preferences.barcodeAutoAccept;
  }
  try {
    const household = await Household.findById(user.householdId).select('settings');
    return household?.settings?.barcodeAutoAccept ?? false;
  } catch {
    return false;
  }
}

module.exports = router;
