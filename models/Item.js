const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  name: { type: String, required: true, trim: true },
  brand: { type: String, trim: true, default: '' },
  category: { type: String, required: true, trim: true },
  unit: { type: String, required: true, trim: true },
  size: { type: Number, default: null },
  barcode: { type: String, trim: true },
  upc: { type: String, trim: true, default: null },
  upcSource: { type: String, enum: ['scan', 'backfill', 'manual'], default: null },
  upcPendingLookup: { type: Boolean, default: false },
  isOrganic: { type: Boolean, default: false },
  isSeeded: { type: Boolean, default: false },
  lastConflict: {
    resolvedAt: { type: Date },
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    winnerName: { type: String },
    overwrittenValue: { type: mongoose.Schema.Types.Mixed }
  }
}, { timestamps: true });

itemSchema.index({ householdId: 1, name: 1 });
itemSchema.index({ householdId: 1, upc: 1 }, { sparse: true });

module.exports = mongoose.model('Item', itemSchema);
