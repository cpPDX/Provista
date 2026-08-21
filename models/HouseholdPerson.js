const mongoose = require('mongoose');

const householdPersonSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  displayName: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

householdPersonSchema.index(
  { householdId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } }
);
householdPersonSchema.index({ householdId: 1, active: 1, sortOrder: 1, displayName: 1 });

module.exports = mongoose.model('HouseholdPerson', householdPersonSchema);
