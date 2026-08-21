const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const Store = require('../models/Store');
const PriceEntry = require('../models/PriceEntry');
const { requireAuth } = require('../middleware/auth');
const { normalizeUpc } = require('../utils/upc');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new RequestError(status, message);
}

function parseNonNegative(value, field, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(400, `${field} is required`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) fail(400, `${field} must be a non-negative number`);
  return parsed;
}

function parsePositive(value, field, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) fail(400, `${field} must be a positive number`);
  return parsed;
}

function calcFinalPrice(regularPrice, salePrice, couponAmount) {
  const base = salePrice != null && salePrice < regularPrice ? salePrice : regularPrice;
  return Math.max(0, base - (couponAmount || 0));
}

// POST /api/grocery/log
// One user action can create/select the catalog item and store, then record its price.
// Adding a catalog item or store is non-destructive household collaboration.
// Replacing existing price history remains admin/owner controlled.
router.post('/log', requireAuth, async (req, res) => {
  const householdId = req.user.householdId;
  const isAdmin = ['admin', 'owner'].includes(req.user.role);
  let createdItem = null;
  let createdStore = null;
  let createdEntry = null;

  try {
    const regularPrice = parseNonNegative(req.body.regularPrice, 'regularPrice', true);
    const salePrice = parseNonNegative(req.body.salePrice, 'salePrice');
    const couponAmount = parseNonNegative(req.body.couponAmount, 'couponAmount');
    const quantity = parsePositive(req.body.quantity, 'quantity', 1);
    const source = ['manual', 'csv'].includes(req.body.source) ? req.body.source : 'manual';
    const entryDate = req.body.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(entryDate.getTime())) fail(400, 'date must be a valid date');

    let replacement = null;
    if (req.body.replacePriceEntryId) {
      if (!isAdmin) fail(403, 'Admin or owner role required to replace an existing price entry');
      replacement = await PriceEntry.findOne({
        _id: req.body.replacePriceEntryId,
        householdId
      });
      if (!replacement) fail(404, 'Price entry to replace was not found in this household');
    }

    let item;
    if (req.body.itemId) {
      item = await Item.findOne({ _id: req.body.itemId, householdId });
      if (!item) fail(404, 'Item not found in this household');
    } else if (req.body.item) {
      const data = req.body.item;
      const name = String(data.name || '').trim();
      const category = String(data.category || '').trim();
      const unit = String(data.unit || '').trim();
      if (!name) fail(400, 'item.name is required');
      if (!category) fail(400, 'item.category is required');
      if (!unit) fail(400, 'item.unit is required');

      const size = data.size === undefined || data.size === null || data.size === ''
        ? null
        : parsePositive(data.size, 'item.size');
      const upc = data.upc ? (normalizeUpc(String(data.upc)) ?? null) : null;

      item = await Item.create({
        householdId,
        name,
        brand: String(data.brand || '').trim(),
        category,
        unit,
        size,
        isOrganic: Boolean(data.isOrganic),
        upc,
        upcSource: upc ? 'manual' : null,
        isSeeded: false
      });
      createdItem = item;
    } else {
      fail(400, 'itemId or item is required');
    }

    let store;
    if (req.body.storeId) {
      store = await Store.findOne({ _id: req.body.storeId, householdId });
      if (!store) fail(404, 'Store not found in this household');
    } else if (req.body.store) {
      const name = String(req.body.store.name || '').trim();
      if (!name) fail(400, 'store.name is required');
      store = await Store.create({
        householdId,
        name,
        location: String(req.body.store.location || '').trim()
      });
      createdStore = store;
    } else {
      fail(400, 'storeId or store is required');
    }

    if (!replacement && req.body.replaceSameDay) {
      if (!isAdmin) fail(403, 'Admin or owner role required to replace an existing price entry');
      if (source !== 'csv') fail(400, 'replaceSameDay is only supported for CSV imports');

      const dayStart = new Date(Date.UTC(
        entryDate.getUTCFullYear(), entryDate.getUTCMonth(), entryDate.getUTCDate()
      ));
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      replacement = await PriceEntry.findOne({
        householdId,
        itemId: item._id,
        storeId: store._id,
        status: 'approved',
        date: { $gte: dayStart, $lt: dayEnd }
      }).sort({ createdAt: -1 });
    }

    if (replacement &&
        (String(replacement.itemId) !== String(item._id) || String(replacement.storeId) !== String(store._id))) {
      fail(400, 'Replacement price entry must use the same item and store');
    }

    const finalPrice = calcFinalPrice(regularPrice, salePrice, couponAmount);
    createdEntry = await PriceEntry.create({
      householdId,
      itemId: item._id,
      storeId: store._id,
      submittedBy: req.user._id,
      regularPrice,
      salePrice,
      couponAmount,
      couponCode: req.body.couponCode ? String(req.body.couponCode).trim() : null,
      finalPrice,
      quantity,
      pricePerUnit: finalPrice / quantity,
      date: entryDate,
      notes: req.body.notes ? String(req.body.notes).trim() : '',
      source,
      status: isAdmin ? 'approved' : 'pending',
      reviewedBy: isAdmin ? req.user._id : null,
      reviewedAt: isAdmin ? new Date() : null
    });

    // Populate before touching the prior record. If this step fails, the new
    // entry is rolled back and the original price remains intact.
    const populated = await createdEntry.populate([
      { path: 'itemId', select: 'name brand unit size category isOrganic upc' },
      { path: 'storeId', select: 'name location' }
    ]);

    if (replacement) {
      const deleted = await PriceEntry.deleteOne({ _id: replacement._id, householdId });
      if (deleted.deletedCount !== 1) fail(409, 'Price entry changed before it could be replaced');
    }

    res.status(201).json({
      entry: populated,
      createdItem: createdItem || null,
      createdStore: createdStore || null,
      replacedPriceEntryId: replacement ? String(replacement._id) : null
    });
  } catch (err) {
    // Compensating rollback keeps a failed multi-record action from leaving
    // orphan item/store/price records. Replacement deletion happens last, so the
    // original entry remains available whenever an earlier step fails.
    await Promise.allSettled([
      createdEntry ? PriceEntry.deleteOne({ _id: createdEntry._id, householdId }) : Promise.resolve(),
      createdItem ? Item.deleteOne({ _id: createdItem._id, householdId }) : Promise.resolve(),
      createdStore ? Store.deleteOne({ _id: createdStore._id, householdId }) : Promise.resolve()
    ]);

    const status = err instanceof RequestError ? err.status : 400;
    const message = err instanceof RequestError ? err.message : serverErr(err);
    res.status(status).json({ error: message });
  }
});

module.exports = router;
