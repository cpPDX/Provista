const mongoose = require('mongoose');

function generateInviteCode() {
  // Exclude ambiguous chars: 0, O, I, 1, L
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const householdSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  inviteCode: { type: String, default: null },
  inviteCodeExpiresAt: { type: Date, default: null },
  weekStartDay: { type: Number, default: 6 },
  settings: {
    barcodeAutoAccept: { type: Boolean, default: false }
  }
}, { timestamps: true });

householdSchema.methods.refreshInviteCode = function () {
  this.inviteCode = generateInviteCode();
  this.inviteCodeExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
  return this;
};

householdSchema.methods.isInviteCodeValid = function () {
  return this.inviteCode && this.inviteCodeExpiresAt > new Date();
};

module.exports = mongoose.model('Household', householdSchema);
