const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  displayName: { type: String, trim: true, default: '' },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', default: null },
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
  passwordResetTokenHash: { type: String, default: null, select: false },
  passwordResetExpiresAt: { type: Date, default: null, select: false },
  preferences: {
    barcodeAutoAccept: { type: Boolean, default: null },  // null = inherit household setting
    theme: { type: String, enum: ['light', 'dark'], default: 'light' }
  }
}, { timestamps: true });

userSchema.virtual('effectiveDisplayName').get(function () {
  return this.displayName || (this.name ? this.name.trim().split(/\s+/)[0] : '');
});

module.exports = mongoose.model('User', userSchema);
