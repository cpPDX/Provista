const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  location: { type: String, trim: true }
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);
