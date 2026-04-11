const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  name: { type: String, required: true, trim: true },
  brand: { type: String, trim: true, default: '' },
  category: { type: String, required: true, trim: true },
  unit: { type: String, required: true, trim: true },
  size: { type: Number, default: null },
  barcode: { type: String, trim: true },
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

module.exports = mongoose.model('Item', itemSchema);
