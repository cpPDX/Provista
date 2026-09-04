const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

function ensureMealInstanceIds(days) {
  let changed = false;
  for (const day of (Array.isArray(days) ? days : [])) {
    for (const meal of (Array.isArray(day?.meals) ? day.meals : [])) {
      if (!String(meal?.instanceId || '').trim()) {
        meal.instanceId = randomUUID();
        changed = true;
      }
    }
  }
  return changed;
}

const mealSchema = new mongoose.Schema({
  // Stable identity survives edits and moves so reconciled Pantry events stay
  // attributable to the same meal instance rather than array position.
  instanceId: { type: String, trim: true, default: randomUUID },
  mealType: { type: String, enum: ['breakfast', 'lunch', 'dinner', 'special'], required: true },
  // personName remains for backward compatibility with existing plans while personIds is rolled out.
  personName: { type: String, trim: true, default: '' },
  personIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'HouseholdPerson' }],
  // Intentionally no schema default: legacy rows predate this field. New scaffolds explicitly set true.
  forEveryone: { type: Boolean },
  name: { type: String, trim: true, default: '' },
  notes: { type: String, trim: true, default: '' }
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

mealPlanSchema.pre('validate', function assignMealInstanceIds(next) {
  ensureMealInstanceIds(this.days);
  next();
});

mealPlanSchema.pre('findOneAndUpdate', function assignUpdateMealInstanceIds(next) {
  const update = this.getUpdate() || {};
  const days = update?.$set?.days ?? update?.days;
  if (Array.isArray(days)) ensureMealInstanceIds(days);
  next();
});

mealPlanSchema.index({ householdId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model('MealPlan', mealPlanSchema);
module.exports.ensureMealInstanceIds = ensureMealInstanceIds;
