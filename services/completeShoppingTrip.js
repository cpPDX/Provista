const mongoose = require('mongoose');
const InventoryItem = require('../models/InventoryItem');
const PriceEntry = require('../models/PriceEntry');
const ShoppingListItem = require('../models/ShoppingListItem');
const ShoppingTrip = require('../models/ShoppingTrip');
const Store = require('../models/Store');

const MAX_TRIP_ITEMS = 200;
let transactionSupportPromise;

class ShoppingTripError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new ShoppingTripError(status, message);
}

function withSession(query, session) {
  return session ? query.session(session) : query;
}

function writeOptions(session, extra = {}) {
  return session ? { ...extra, session } : extra;
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeRequest({ idempotencyKey, purchases, addToPantry }) {
  const key = String(idempotencyKey || '').trim();
  if (!key) fail(400, 'idempotencyKey is required');
  if (key.length > 100) fail(400, 'idempotencyKey is too long');
  if (!Array.isArray(purchases) || purchases.length === 0) {
    fail(400, 'At least one purchased item is required');
  }
  if (purchases.length > MAX_TRIP_ITEMS) {
    fail(400, `A shopping trip cannot contain more than ${MAX_TRIP_ITEMS} items`);
  }

  const seen = new Set();
  const normalizedPurchases = purchases.map((purchase, index) => {
    const listItemId = String(purchase?.listItemId || '');
    if (!mongoose.isValidObjectId(listItemId)) {
      fail(400, `purchases[${index}].listItemId is invalid`);
    }
    if (seen.has(listItemId)) fail(400, 'Each shopping-list item can only be completed once');
    seen.add(listItemId);

    let price = null;
    if (purchase.price !== undefined && purchase.price !== null && purchase.price !== '') {
      price = Number(purchase.price);
      if (!Number.isFinite(price) || price < 0) {
        fail(400, `purchases[${index}].price must be a non-negative number or null`);
      }
      price = roundCurrency(price);
    }

    const storeId = purchase.storeId ? String(purchase.storeId) : null;
    if (storeId && !mongoose.isValidObjectId(storeId)) {
      fail(400, `purchases[${index}].storeId is invalid`);
    }
    if (price !== null && !storeId) {
      fail(400, `Choose a store for purchases[${index}] before recording its price`);
    }

    return { listItemId, price, storeId };
  });

  return {
    idempotencyKey: key,
    purchases: normalizedPurchases,
    addToPantry: addToPantry !== false
  };
}

async function databaseSupportsTransactions() {
  if (!transactionSupportPromise) {
    transactionSupportPromise = mongoose.connection.db.admin().command({ hello: 1 })
      .then(hello => Boolean(hello.setName || hello.msg === 'isdbgrid'))
      .catch(() => false);
  }
  return transactionSupportPromise;
}

async function findExistingTrip(householdId, idempotencyKey, session) {
  return withSession(ShoppingTrip.findOne({ householdId, idempotencyKey }), session);
}

function tripSummary(trip, idempotent = false) {
  return {
    tripId: String(trip._id),
    completedAt: trip.completedAt,
    total: trip.total,
    itemCount: trip.itemCount,
    pricedItemCount: trip.pricedItemCount,
    missingPriceCount: trip.missingPriceCount,
    pantryUpdated: trip.addToPantry,
    pantryItemCount: trip.pantryItemCount,
    approvedPriceCount: trip.approvedPriceCount,
    pendingPriceCount: trip.pendingPriceCount,
    lowStockCount: trip.lowStockCount,
    idempotent
  };
}

async function loadTripContext(householdId, purchases, session) {
  const listItemIds = purchases.map(purchase => purchase.listItemId);
  const listQuery = ShoppingListItem.find({
    _id: { $in: listItemIds },
    householdId,
    checked: true
  }).populate({
    path: 'itemId',
    match: { householdId },
    select: 'name brand category unit size isOrganic'
  });
  const listItems = await withSession(listQuery, session);

  if (listItems.length !== purchases.length || listItems.some(item => !item.itemId)) {
    fail(409, 'The shopping list changed. Refresh it before finishing this trip.');
  }

  const listById = new Map(listItems.map(item => [String(item._id), item]));
  const storeIds = [...new Set(purchases.map(purchase => purchase.storeId).filter(Boolean))];
  const stores = storeIds.length
    ? await withSession(Store.find({ _id: { $in: storeIds }, householdId }).select('name'), session)
    : [];
  if (stores.length !== storeIds.length) fail(404, 'One or more stores were not found in this household');
  const storesById = new Map(stores.map(store => [String(store._id), store]));

  const snapshots = purchases.map(purchase => {
    const listItem = listById.get(purchase.listItemId);
    const quantity = Number(listItem.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      fail(409, `${listItem.itemId.name} has an invalid shopping-list quantity`);
    }
    const store = purchase.storeId ? storesById.get(purchase.storeId) : null;
    return {
      shoppingListItemId: listItem._id,
      itemId: listItem.itemId._id,
      itemName: listItem.itemId.name,
      category: listItem.itemId.category || 'Other',
      unit: listItem.itemId.unit || '',
      quantity,
      storeId: store?._id || null,
      storeName: store?.name || '',
      price: purchase.price,
      priceEntryId: null
    };
  });

  return { listItems, snapshots };
}

async function countLowStock(householdId, session) {
  const query = InventoryItem.find({ householdId })
    .select('quantity lowStockThreshold stockStatus')
    .lean();
  const items = await withSession(query, session);
  return items.filter(item =>
    item.stockStatus === 'low' || item.stockStatus === 'out' || (
      item.lowStockThreshold != null && item.quantity <= item.lowStockThreshold
    )
  ).length;
}

async function applyPantryUpdates({ householdId, userId, tripId, snapshots, session, rollback }) {
  const totalsByItem = new Map();
  for (const item of snapshots) {
    const key = String(item.itemId);
    const existing = totalsByItem.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      totalsByItem.set(key, { itemId: item.itemId, quantity: item.quantity, unit: item.unit });
    }
  }
  const updates = [...totalsByItem.values()];
  if (!updates.length) return 0;

  if (rollback) {
    const backupQuery = InventoryItem.find({
      householdId,
      itemId: { $in: updates.map(update => update.itemId) }
    }).lean();
    rollback.inventoryBefore = await withSession(backupQuery, session);
    rollback.inventoryItemIds = updates.map(update => update.itemId);
  }

  await InventoryItem.bulkWrite(updates.map(update => ({
    updateOne: {
      filter: { householdId, itemId: update.itemId },
      update: {
        $inc: { quantity: update.quantity },
        $set: {
          stockStatus: 'have',
          lastUpdated: new Date(),
          lastUpdatedBy: userId,
          lastPurchaseTripId: tripId
        },
        $setOnInsert: {
          householdId,
          itemId: update.itemId,
          unit: update.unit
        }
      },
      upsert: true
    }
  })), writeOptions(session, { ordered: true }));

  return updates.length;
}

async function executeTrip({ householdId, userId, role, strictPriceReview, request }, session, rollback = null) {
  const existing = await findExistingTrip(householdId, request.idempotencyKey, session);
  if (existing?.status === 'completed') return tripSummary(existing, true);
  if (existing) fail(409, 'This shopping trip is already being processed');

  const { listItems, snapshots } = await loadTripContext(householdId, request.purchases, session);
  const now = new Date();
  const total = roundCurrency(snapshots.reduce((sum, item) => sum + (item.price ?? 0), 0));
  const pricedItemCount = snapshots.filter(item => item.price !== null).length;
  const missingPriceCount = snapshots.length - pricedItemCount;
  const isAdmin = ['admin', 'owner'].includes(role);
  const trustSubmittedPrices = isAdmin || !strictPriceReview;

  const trip = new ShoppingTrip({
    householdId,
    completedBy: userId,
    idempotencyKey: request.idempotencyKey,
    status: 'processing',
    addToPantry: request.addToPantry,
    items: snapshots,
    total,
    itemCount: snapshots.length,
    pricedItemCount,
    missingPriceCount
  });
  await trip.save(writeOptions(session));
  if (rollback) rollback.tripId = trip._id;

  const priceDocuments = snapshots
    .filter(item => item.price !== null)
    .map(item => ({
      householdId,
      itemId: item.itemId,
      storeId: item.storeId,
      submittedBy: userId,
      regularPrice: item.price,
      salePrice: null,
      couponAmount: null,
      couponCode: null,
      finalPrice: item.price,
      quantity: item.quantity,
      pricePerUnit: item.price / item.quantity,
      date: now,
      source: 'shopping-trip',
      shoppingTripId: trip._id,
      status: trustSubmittedPrices ? 'approved' : 'pending',
      reviewedBy: trustSubmittedPrices ? userId : null,
      reviewedAt: trustSubmittedPrices ? now : null,
      notes: 'Recorded when shopping trip was completed'
    }));

  const priceEntries = priceDocuments.length
    ? await PriceEntry.insertMany(priceDocuments, writeOptions(session, { ordered: true }))
    : [];
  let priceIndex = 0;
  for (const item of trip.items) {
    if (item.price !== null) item.priceEntryId = priceEntries[priceIndex++]._id;
  }

  const pantryItemCount = request.addToPantry
    ? await applyPantryUpdates({
      householdId,
      userId,
      tripId: trip._id,
      snapshots,
      session,
      rollback
    })
    : 0;

  if (rollback) {
    rollback.deletedListItems = listItems.map(item => item.toObject());
  }
  const deleted = await ShoppingListItem.deleteMany(
    { _id: { $in: listItems.map(item => item._id) }, householdId, checked: true },
    writeOptions(session)
  );
  if (deleted.deletedCount !== listItems.length) {
    fail(409, 'The shopping list changed while the trip was being completed');
  }

  trip.status = 'completed';
  trip.completedAt = now;
  trip.pantryItemCount = pantryItemCount;
  trip.approvedPriceCount = trustSubmittedPrices ? priceEntries.length : 0;
  trip.pendingPriceCount = trustSubmittedPrices ? 0 : priceEntries.length;
  trip.lowStockCount = await countLowStock(householdId, session);
  await trip.save(writeOptions(session));

  return tripSummary(trip);
}

async function restoreDeletedListItems(items) {
  if (!items?.length) return;
  await ShoppingListItem.bulkWrite(items.map(item => {
    const { _id, ...fields } = item;
    return {
      updateOne: {
        filter: { _id },
        update: { $setOnInsert: fields },
        upsert: true
      }
    };
  }), { ordered: false });
}

async function restoreInventory(rollback) {
  if (!rollback.tripId || !rollback.inventoryItemIds?.length) return;
  const beforeByItem = new Map(
    (rollback.inventoryBefore || []).map(item => [String(item.itemId), item])
  );
  const operations = rollback.inventoryItemIds.map(itemId => {
    const before = beforeByItem.get(String(itemId));
    if (before) {
      return {
        replaceOne: {
          filter: { _id: before._id, lastPurchaseTripId: rollback.tripId },
          replacement: before
        }
      };
    }
    return {
      deleteOne: {
        filter: { householdId: rollback.householdId, itemId, lastPurchaseTripId: rollback.tripId }
      }
    };
  });
  await InventoryItem.bulkWrite(operations, { ordered: false });
}

async function rollbackStandaloneCompletion(rollback) {
  if (!rollback.tripId) return;
  const results = await Promise.allSettled([
    restoreDeletedListItems(rollback.deletedListItems),
    restoreInventory(rollback),
    PriceEntry.deleteMany({ householdId: rollback.householdId, shoppingTripId: rollback.tripId }),
    ShoppingTrip.deleteOne({ _id: rollback.tripId, householdId: rollback.householdId })
  ]);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    console.error('Shopping trip rollback was incomplete', failures.map(result => result.reason?.message));
  }
}

async function executeWithCompensation(input) {
  const rollback = { householdId: input.householdId };
  try {
    return await executeTrip(input, null, rollback);
  } catch (err) {
    await rollbackStandaloneCompletion(rollback);
    if (err?.code === 11000) {
      const existing = await findExistingTrip(
        input.householdId,
        input.request.idempotencyKey,
        null
      );
      if (existing?.status === 'completed') return tripSummary(existing, true);
      fail(409, 'This shopping trip is already being processed');
    }
    throw err;
  }
}

async function completeShoppingTrip({ householdId, userId, role, strictPriceReview = false, body }) {
  const input = {
    householdId,
    userId,
    role,
    strictPriceReview,
    request: normalizeRequest(body)
  };

  if (!(await databaseSupportsTransactions())) {
    return executeWithCompensation(input);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await executeTrip(input, session);
    });
    return result;
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await findExistingTrip(
        input.householdId,
        input.request.idempotencyKey,
        null
      );
      if (existing?.status === 'completed') return tripSummary(existing, true);
      fail(409, 'This shopping trip is already being processed');
    }
    throw err;
  } finally {
    await session.endSession();
  }
}

module.exports = { completeShoppingTrip, ShoppingTripError };
