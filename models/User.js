const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', default: null },
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
  preferences: {
    barcodeAutoAccept: { type: Boolean, default: null }  // null = inherit household setting
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
