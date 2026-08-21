const mongoose = require('mongoose');

const shoppingTripItemSchema = new mongoose.Schema({
  shoppingListItemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  itemName: { type: String, required: true, trim: true },
  category: { type: String, trim: true, default: 'Other' },
  unit: { type: String, trim: true, default: '' },
  quantity: { type: Number, required: true, min: 0 },
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
  storeName: { type: String, trim: true, default: '' },
  price: { type: Number, min: 0, default: null },
  priceEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'PriceEntry', default: null }
}, { _id: false });

const shoppingTripSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  completedAt: { type: Date, default: null },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 100 },
  status: { type: String, enum: ['processing', 'completed'], default: 'processing' },
  addToPantry: { type: Boolean, default: true },
  items: { type: [shoppingTripItemSchema], default: [] },
  total: { type: Number, required: true, min: 0, default: 0 },
  itemCount: { type: Number, required: true, min: 0, default: 0 },
  pricedItemCount: { type: Number, required: true, min: 0, default: 0 },
  missingPriceCount: { type: Number, required: true, min: 0, default: 0 },
  pantryItemCount: { type: Number, required: true, min: 0, default: 0 },
  approvedPriceCount: { type: Number, required: true, min: 0, default: 0 },
  pendingPriceCount: { type: Number, required: true, min: 0, default: 0 },
  lowStockCount: { type: Number, required: true, min: 0, default: 0 }
}, { timestamps: true });

shoppingTripSchema.index({ householdId: 1, idempotencyKey: 1 }, { unique: true });
shoppingTripSchema.index({ householdId: 1, status: 1, completedAt: -1 });

module.exports = mongoose.model('ShoppingTrip', shoppingTripSchema);
