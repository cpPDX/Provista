const mongoose = require('mongoose');
const {
  DEFAULT_DEPARTMENTS,
  PLACEMENT_PROVENANCE,
  applyStorePlacementInference
} = require('../utils/storePlacement');

// Compatibility export for older callers. PRO-94 replaces the flat section
// model with departments + optional sub-sections, but retaining this alias
// avoids breaking code that only needs the familiar department suggestions.
const STORE_SECTIONS = DEFAULT_DEPARTMENTS;

function normalizeUnit(value) {
  const unit = String(value || '').trim();
  return !unit || /^\d+(?:\.\d+)?$/.test(unit) ? 'each' : unit;
}

const itemAliasSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 120 },
  normalized: { type: String, required: true, trim: true, maxlength: 120 },
  source: {
    type: String,
    enum: ['user-entry', 'receipt', 'import'],
    default: 'user-entry'
  },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  confirmedAt: { type: Date, default: Date.now }
}, { _id: true });

const storePlacementOverrideSchema = new mongoose.Schema({
  // Stable household Store identity. Never key placement by display name.
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  department: { type: String, trim: true, maxlength: 80, default: null },
  subSection: { type: String, trim: true, maxlength: 80, default: null },
  departmentProvenance: { type: String, enum: PLACEMENT_PROVENANCE, default: null },
  subSectionProvenance: { type: String, enum: PLACEMENT_PROVENANCE, default: null },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const itemSchema = new mongoose.Schema({
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  name: { type: String, required: true, trim: true },
  brand: { type: String, trim: true, default: '' },
  category: { type: String, required: true, trim: true },
  unit: { type: String, required: true, trim: true, set: normalizeUnit },
  size: { type: Number, default: null },
  barcode: { type: String, trim: true },
  upc: { type: String, trim: true, default: null },
  upcSource: { type: String, enum: ['scan', 'backfill', 'manual'], default: null },
  upcPendingLookup: { type: Boolean, default: false },

  // Legacy flat shopping placement. Keep this field readable so existing data
  // can be migrated conservatively. Unknown legacy values are copied into the
  // department model as legacy_preserved rather than reclassified.
  storeSection: { type: String, trim: true, maxlength: 80, default: null },
  storeDepartment: { type: String, trim: true, maxlength: 80, default: null },
  storeSubSection: { type: String, trim: true, maxlength: 80, default: null },
  storeDepartmentProvenance: { type: String, enum: PLACEMENT_PROVENANCE, default: null },
  storeSubSectionProvenance: { type: String, enum: PLACEMENT_PROVENANCE, default: null },
  storePlacementInferenceVersion: { type: Number, default: null },
  storePlacementOverrides: { type: [storePlacementOverrideSchema], default: [] },

  // Provider-specific product identifiers. UPC remains the preferred shared
  // identifier, but providers can cache their own IDs here when needed.
  externalIds: { type: Map, of: String, default: {} },
  aliases: { type: [itemAliasSchema], default: [] },
  isOrganic: { type: Boolean, default: false },
  isSeeded: { type: Boolean, default: false },
  lastConflict: {
    resolvedAt: { type: Date },
    winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    winnerName: { type: String },
    overwrittenValue: { type: mongoose.Schema.Types.Mixed }
  }
}, { timestamps: true });

itemSchema.pre('validate', function applyPlacement(next) {
  try {
    applyStorePlacementInference(this);
    next();
  } catch (error) {
    next(error);
  }
});

itemSchema.index({ householdId: 1, name: 1 });
itemSchema.index({ householdId: 1, upc: 1 }, { sparse: true });
itemSchema.index({ householdId: 1, 'aliases.normalized': 1 });
itemSchema.index({ householdId: 1, 'storePlacementOverrides.storeId': 1 });

module.exports = mongoose.model('Item', itemSchema);
module.exports.STORE_SECTIONS = STORE_SECTIONS;
module.exports.normalizeUnit = normalizeUnit;
