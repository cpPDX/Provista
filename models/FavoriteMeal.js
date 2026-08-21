const mongoose = require('mongoose');

const favoriteMealSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  normalizedName: { type: String, required: true, trim: true, maxlength: 120 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  notes: { type: String, trim: true, default: '', maxlength: 2000 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  useCount: { type: Number, min: 0, default: 0 },
  lastUsedAt: { type: Date, default: Date.now }
}, { timestamps: true });

favoriteMealSchema.index({ householdId: 1, normalizedName: 1 }, { unique: true });
favoriteMealSchema.index({ householdId: 1, useCount: -1, lastUsedAt: -1 });

module.exports = mongoose.model('FavoriteMeal', favoriteMealSchema);
