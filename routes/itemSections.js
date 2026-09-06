const express = require('express');
const router = express.Router();
const Item = require('../models/Item');
const Store = require('../models/Store');
const { requireAuth } = require('../middleware/auth');
const {
  DEFAULT_DEPARTMENTS,
  DEFAULT_SUBSECTIONS,
  normalize,
  inferStorePlacement,
  applyStorePlacementInference
} = require('../utils/storePlacement');

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function normalizeOptional(value) {
  const normalized = normalize(value);
  return normalized || null;
}

function validatePlacementValue(value, label, { allowEmpty = false } = {}) {
  const normalized = normalize(value);
  if (!allowEmpty && !normalized) return `${label} is required`;
  if (normalized.length > 80) return `${label} must be 80 characters or fewer`;
  return null;
}

function placementRecord(item) {
  const inferred = inferStorePlacement(item);
  return {
    itemId: String(item._id),
    department: normalize(item.storeDepartment) || inferred.department,
    subSection: normalizeOptional(item.storeSubSection),
    departmentProvenance: item.storeDepartmentProvenance || 'inferred',
    subSectionProvenance: item.storeSubSectionProvenance || 'inferred',
    inferenceVersion: item.storePlacementInferenceVersion || inferred.version,
    inferred,
    storeOverrides: (item.storePlacementOverrides || []).map(entry => ({
      storeId: String(entry.storeId?._id || entry.storeId),
      department: normalizeOptional(entry.department),
      subSection: normalizeOptional(entry.subSection),
      departmentProvenance: entry.departmentProvenance || null,
      subSectionProvenance: entry.subSectionProvenance || null
    }))
  };
}

function departmentSuggestions(items) {
  const custom = new Set();
  for (const item of items) {
    const values = [item.storeDepartment, item.storeSection];
    for (const override of item.storePlacementOverrides || []) values.push(override.department);
    for (const value of values) {
      const department = normalize(value);
      if (department && !DEFAULT_DEPARTMENTS.includes(department)) custom.add(department);
    }
  }
  return [
    ...DEFAULT_DEPARTMENTS.filter(value => value !== 'Other'),
    ...[...custom].sort((left, right) => left.localeCompare(right)),
    'Other'
  ];
}

function subSectionSuggestions(items) {
  const result = Object.fromEntries(
    Object.entries(DEFAULT_SUBSECTIONS).map(([department, values]) => [department, [...values]])
  );

  const add = (departmentValue, subSectionValue) => {
    const department = normalize(departmentValue);
    const subSection = normalize(subSectionValue);
    if (!department || !subSection) return;
    const values = result[department] || [];
    if (!values.includes(subSection)) values.push(subSection);
    result[department] = values;
  };

  for (const item of items) {
    add(item.storeDepartment || item.storeSection, item.storeSubSection);
    for (const override of item.storePlacementOverrides || []) {
      add(override.department || item.storeDepartment || item.storeSection, override.subSection);
    }
  }

  for (const [department, values] of Object.entries(result)) {
    const defaults = DEFAULT_SUBSECTIONS[department] || [];
    const custom = values.filter(value => !defaults.includes(value)).sort((left, right) => left.localeCompare(right));
    result[department] = [...defaults, ...custom];
  }
  return result;
}

async function loadHouseholdItems(householdId) {
  const items = await Item.find({ householdId })
    .select('name category unit storeSection storeDepartment storeSubSection storeDepartmentProvenance storeSubSectionProvenance storePlacementInferenceVersion storePlacementOverrides updatedAt')
    .sort({ updatedAt: -1 });

  const changed = items.filter(item => applyStorePlacementInference(item));
  if (changed.length) await Promise.all(changed.map(item => item.save()));
  return items;
}

// GET /api/item-sections - two-level shopping placement plus reusable custom
// values. The route name remains stable for compatibility with PRO-74 clients.
router.get('/', requireAuth, async (req, res) => {
  try {
    const items = await loadHouseholdItems(req.user.householdId);
    const placements = items.map(placementRecord);
    const suggestions = departmentSuggestions(items);

    res.json({
      departments: DEFAULT_DEPARTMENTS,
      departmentSuggestions: suggestions,
      subSectionsByDepartment: subSectionSuggestions(items),
      placements,

      // Compatibility aliases for clients that still understand one broad
      // section. Only explicit/legacy values appear in saved so inferred values
      // are not accidentally treated as household-authored corrections.
      defaults: DEFAULT_DEPARTMENTS,
      suggestions,
      saved: items
        .filter(item => normalize(item.storeSection))
        .map(item => ({ itemId: String(item._id), storeSection: normalize(item.storeSection) }))
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/item-sections/:id - correct department and/or optional sub-section.
// Household is the default scope. Store scope requires a concrete stable Store
// ID that belongs to the same household; display-name matching is never used.
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const scope = body.scope === 'store' ? 'store' : 'household';
    const hasDepartment = hasOwn(body, 'department') || hasOwn(body, 'storeSection');
    const hasSubSection = hasOwn(body, 'subSection');
    if (!hasDepartment && !hasSubSection) {
      return res.status(400).json({ error: 'Department or sub-section is required' });
    }

    const department = hasDepartment ? normalize(body.department ?? body.storeSection) : null;
    const subSection = hasSubSection ? normalizeOptional(body.subSection) : undefined;
    if (hasDepartment) {
      const error = validatePlacementValue(department, 'Department');
      if (error) return res.status(400).json({ error });
    }
    if (hasSubSection) {
      const error = validatePlacementValue(subSection, 'Sub-section', { allowEmpty: true });
      if (error) return res.status(400).json({ error });
    }

    const item = await Item.findOne({ _id: req.params.id, householdId: req.user.householdId });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    applyStorePlacementInference(item);

    if (scope === 'store') {
      const storeId = normalize(body.storeId);
      if (!storeId) return res.status(400).json({ error: 'A concrete store is required for a store-specific correction' });
      const store = await Store.findOne({ _id: storeId, householdId: req.user.householdId }).select('_id').lean();
      if (!store) return res.status(404).json({ error: 'Store not found' });

      let override = item.storePlacementOverrides.find(entry => String(entry.storeId) === String(store._id));
      if (!override) {
        item.storePlacementOverrides.push({ storeId: store._id });
        override = item.storePlacementOverrides[item.storePlacementOverrides.length - 1];
      }
      if (hasDepartment) {
        override.department = department;
        override.departmentProvenance = 'store_override';
      }
      if (hasSubSection) {
        override.subSection = subSection;
        override.subSectionProvenance = 'store_override';
      }
      override.updatedAt = new Date();
    } else {
      if (hasDepartment) {
        item.storeDepartment = department;
        item.storeDepartmentProvenance = 'household_override';
        // Mirror the broad household correction for older clients/data tools.
        item.storeSection = department;
      }
      if (hasSubSection) {
        item.storeSubSection = subSection;
        item.storeSubSectionProvenance = 'household_override';
      }
    }

    await item.save();
    res.json({
      _id: String(item._id),
      storeSection: item.storeDepartment,
      placement: placementRecord(item)
    });
  } catch (err) {
    if (err?.name === 'CastError') return res.status(404).json({ error: 'Item or store not found' });
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
