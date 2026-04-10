const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  name: { type: String, required: true, trim: true },
  location: { type: String, trim: true },
  lastConflict: {
    resolvedAt: { type: Date },
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    winnerName: { type: String },
    overwrittenValue: { type: mongoose.Schema.Types.Mixed }
  }
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);
