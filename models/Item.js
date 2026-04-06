const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  unit: { type: String, required: true, trim: true },
  barcode: { type: String, trim: true },
  isOrganic: { type: Boolean, default: false },
  isSeeded: { type: Boolean, default: false }
}, { timestamps: true });

itemSchema.index({ householdId: 1, name: 1 });

module.exports = mongoose.model('Item', itemSchema);
