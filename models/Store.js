const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  name: { type: String, required: true, trim: true },
  location: { type: String, trim: true }
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);
