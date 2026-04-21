const express = require('express');
const https = require('https');
const router = express.Router();
const Item = require('../models/Item');
const Household = require('../models/Household');
const { requireAuth } = require('../middleware/auth');
const { normalizeUpc } = require('../utils/upc');
const { mapCategory } = require('../utils/categoryMap');

const OFF_TIMEOUT_MS = 5000;

// GET /api/barcode/:upc
router.get('/:upc', requireAuth, async (req, res) => {
  const upc = normalizeUpc(req.params.upc);
  if (!upc) return res.status(400).json({ error: 'Invalid UPC format' });

  try {
    // Check local catalog first
    const existing = await Item.findOne({ upc, householdId: req.user.householdId });
    if (existing) {
      return res.json({
        found: true,
        source: 'local',
        confidence: 'full',
        autoAccept: false,
        item: {
          _id: existing._id,
          upc: existing.upc,
          name: existing.name,
          brand: existing.brand,
          category: existing.category,
          unit: existing.unit,
          size: existing.size,
          isOrganic: existing.isOrganic
        },
        missingFields: []
      });
    }

    // Fall back to Open Food Facts
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
        missingFields: ['name', 'category', 'unit']
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
      missingFields
    });
  } catch (err) {
    console.error('Barcode lookup error:', err);
    res.status(500).json({ error: 'Lookup failed' });
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

function normalizeOffProduct(product, upc) {
  const name = (product.product_name_en || product.product_name || '').trim() || null;
  const brand = product.brands ? product.brands.split(',')[0].trim() : '';
  const isOrganic = Array.isArray(product.labels_tags) && product.labels_tags.includes('en:organic');
  const category = mapCategory(product.categories_tags);
  const unit = parseUnit(product.quantity);

  return { upc, name, brand, category, unit, isOrganic };
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
