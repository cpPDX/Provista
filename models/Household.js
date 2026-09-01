const mongoose = require('mongoose');

const INVITE_CODE_LENGTH = 6;
const INVITE_CODE_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

function generateInviteCode() {
  // Exclude ambiguous chars: 0, O, I, 1, L
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const onboardingSchema = new mongoose.Schema({
  version: { type: Number, default: 1 },
  status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
  step: { type: String, enum: ['household', 'action', 'first_action', 'completed'], default: 'household' },
  peopleSkipped: { type: Boolean, default: false },
  householdPeopleCompletedAt: { type: Date, default: null },
  householdPeopleSkippedAt: { type: Date, default: null },
  firstAction: { type: String, enum: ['plan', 'list', null], default: null },
  firstActionSelectedAt: { type: Date, default: null },
  firstUsefulAction: { type: String, enum: ['meal_planned', 'list_item_added', null], default: null },
  firstUsefulActionAt: { type: Date, default: null },
  startedAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  lastResumedAt: { type: Date, default: null },
  resumeCount: { type: Number, default: 0, min: 0 },
  completedAt: { type: Date, default: null }
}, { _id: false });

const householdSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  inviteCode: { type: String, default: null },
  inviteCodeExpiresAt: { type: Date, default: null },
  weekStartDay: { type: Number, default: 6 },
  mealPlanMode: { type: String, enum: ['dinner', 'all'], default: 'dinner' },
  settings: {
    barcodeAutoAccept: { type: Boolean, default: false },
    strictPriceReview: { type: Boolean, default: false },
    usualStoreId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null },
    additionalStopSavingsThreshold: { type: Number, min: 0, default: 10 },
    priceFreshnessDays: { type: Number, min: 1, max: 365, default: 30 }
  },
  // Null for households that predate action-based onboarding. A new household
  // opts into this durable state only when the React client consumes the
  // existing first-run marker and POSTs /api/onboarding/start.
  onboarding: { type: onboardingSchema, default: null }
}, { timestamps: true });

householdSchema.methods.refreshInviteCode = function () {
  this.inviteCode = generateInviteCode();
  this.inviteCodeExpiresAt = new Date(Date.now() + INVITE_CODE_EXPIRY_MS);
  return this;
};

householdSchema.methods.isInviteCodeValid = function () {
  return this.inviteCode && this.inviteCodeExpiresAt > new Date();
};

module.exports = mongoose.model('Household', householdSchema);
