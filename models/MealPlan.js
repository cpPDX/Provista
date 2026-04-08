const mongoose = require('mongoose');

const mealSchema = new mongoose.Schema({
  mealType: { type: String, enum: ['breakfast', 'lunch', 'dinner', 'special'], required: true },
  personName: { type: String, trim: true, default: '' },
  name: { type: String, trim: true, default: '' }
}, { _id: false });

const daySchema = new mongoose.Schema({
  date: { type: Date },
  meals: [mealSchema],
  specialCollapsed: { type: Boolean, default: true }
}, { _id: false });

const mealPlanSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  weekStart: { type: Date, required: true },
  days: [daySchema],
  produceNotes: { type: String, trim: true, default: '' },
  shoppingNotes: { type: String, trim: true, default: '' }
}, { timestamps: true });

mealPlanSchema.index({ householdId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model('MealPlan', mealPlanSchema);
