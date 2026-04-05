const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  category: { type: String, required: true, trim: true },
  unit: { type: String, required: true, trim: true },
  barcode: { type: String, trim: true },
  isSeeded: { type: Boolean, default: false }
}, { timestamps: true });

itemSchema.index({ name: 'text' });
itemSchema.index({ name: 1 });

module.exports = mongoose.model('Item', itemSchema);
