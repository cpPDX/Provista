const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Household = require('../models/Household');
const PriceEntry = require('../models/PriceEntry');
const ShoppingTrip = require('../models/ShoppingTrip');
const Store = require('../models/Store');
const { requireAuth } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }
function roundCurrency(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

router.get('/deferred-prices', requireAuth, async (req, res) => {
  try {
    const trips = await ShoppingTrip.find({
      householdId: req.user.householdId,
      status: 'completed',
      missingPriceCount: { $gt: 0 },
      'items.price': null
    })
      .sort({ completedAt: -1 })
      .limit(50)
      .lean();

    const items = [];
    for (const trip of trips) {
      for (const item of trip.items || []) {
        if (item.price !== null && item.price !== undefined) continue;
        items.push({
          tripId: String(trip._id),
          shoppingListItemId: String(item.shoppingListItemId),
          itemId: String(item.itemId),
          itemName: item.itemName,
          quantity: item.quantity,
          unit: item.unit,
          storeId: item.storeId ? String(item.storeId) : null,
          storeName: item.storeName || '',
          completedAt: trip.completedAt
        });
      }
    }

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.patch('/:tripId/items/:shoppingListItemId/price', requireAuth, async (req, res) => {
  let priceEntry = null;
  try {
    const { tripId, shoppingListItemId } = req.params;
    if (!mongoose.isValidObjectId(tripId) || !mongoose.isValidObjectId(shoppingListItemId)) {
      return res.status(400).json({ error: 'Invalid shopping trip item' });
    }

    const price = roundCurrency(req.body.price);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }

    const householdId = req.user.householdId;
    const trip = await ShoppingTrip.findOne({
      _id: tripId,
      householdId,
      status: 'completed'
    }).lean();
    if (!trip) return res.status(404).json({ error: 'Shopping trip not found' });

    const item = (trip.items || []).find(entry => String(entry.shoppingListItemId) === shoppingListItemId);
    if (!item) return res.status(404).json({ error: 'Shopping trip item not found' });
    if (item.price !== null && item.price !== undefined) {
      return res.status(409).json({ error: 'This price has already been recorded' });
    }

    const storeId = req.body.storeId || item.storeId;
    if (!storeId || !mongoose.isValidObjectId(storeId)) {
      return res.status(400).json({ error: 'Choose a store before recording this price' });
    }
    const store = await Store.findOne({ _id: storeId, householdId }).select('name').lean();
    if (!store) return res.status(404).json({ error: 'Store not found' });

    const household = await Household.findById(householdId).select('settings.strictPriceReview').lean();
    const trustSubmittedPrice = ['admin', 'owner'].includes(req.user.role) || !household?.settings?.strictPriceReview;
    const now = new Date();
    const quantity = Number(item.quantity) || 1;

    priceEntry = await PriceEntry.create({
      householdId,
      itemId: item.itemId,
      storeId: store._id,
      submittedBy: req.user._id,
      regularPrice: price,
      salePrice: null,
      couponAmount: null,
      couponCode: null,
      finalPrice: price,
      quantity,
      pricePerUnit: roundCurrency(price / quantity),
      date: trip.completedAt || now,
      source: 'shopping-trip',
      shoppingTripId: trip._id,
      status: trustSubmittedPrice ? 'approved' : 'pending',
      reviewedBy: trustSubmittedPrice ? req.user._id : null,
      reviewedAt: trustSubmittedPrice ? now : null,
      notes: 'Recorded after shopping trip completion'
    });

    const increments = {
      total: price,
      pricedItemCount: 1,
      missingPriceCount: -1
    };
    if (trustSubmittedPrice) increments.approvedPriceCount = 1;
    else increments.pendingPriceCount = 1;

    const updateResult = await ShoppingTrip.updateOne(
      {
        _id: trip._id,
        householdId,
        status: 'completed',
        items: {
          $elemMatch: {
            shoppingListItemId: new mongoose.Types.ObjectId(shoppingListItemId),
            price: null
          }
        }
      },
      {
        $set: {
          'items.$.price': price,
          'items.$.storeId': store._id,
          'items.$.storeName': store.name,
          'items.$.priceEntryId': priceEntry._id,
          'items.$.priceResolvedAt': now,
          'items.$.priceResolvedBy': req.user._id
        },
        $inc: increments
      },
      { runValidators: true }
    );

    if (updateResult.modifiedCount !== 1) {
      await PriceEntry.deleteOne({ _id: priceEntry._id });
      priceEntry = null;
      return res.status(409).json({ error: 'That price was already updated. Refresh and try again.' });
    }

    const updatedTrip = await ShoppingTrip.findById(trip._id)
      .select('total pricedItemCount missingPriceCount approvedPriceCount pendingPriceCount')
      .lean();

    res.json({
      success: true,
      price,
      storeId: String(store._id),
      storeName: store.name,
      priceEntryStatus: trustSubmittedPrice ? 'approved' : 'pending',
      trip: updatedTrip
    });
  } catch (err) {
    if (priceEntry?._id) await PriceEntry.deleteOne({ _id: priceEntry._id }).catch(() => {});
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
