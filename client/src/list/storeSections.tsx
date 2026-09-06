import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../shell/ToastProvider';
import {
  loadStorePlacements,
  updateStorePlacement,
  type InferredStorePlacement,
  type PlacementProvenance,
  type StorePlacementRecord
} from './storePlacementApi';
import {
  plannedStoreId,
  preferredStoreId,
  productFor,
  productName,
  type ShoppingListItem
} from './types';
import './storeSections.css';

export const DEFAULT_STORE_SECTIONS = [
  'Produce',
  'Meat & Seafood',
  'Deli & Prepared Foods',
  'Dairy & Eggs',
  'Bakery',
  'Pantry / Dry Grocery',
  'Frozen',
  'Beverages',
  'Household',
  'Health & Personal Care',
  'Baby',
  'Pet',
  'Other'
] as const;

export const DEFAULT_STORE_SUBSECTIONS: Record<string, string[]> = {
  Produce: ['Fruit', 'Vegetables', 'Herbs', 'Salad & Packaged Produce'],
  'Meat & Seafood': ['Beef', 'Pork', 'Chicken & Turkey', 'Seafood', 'Sausage & Bacon', 'Plant-based Proteins'],
  'Deli & Prepared Foods': ['Deli Meat', 'Deli Cheese', 'Prepared Meals', 'Rotisserie', 'Dips & Hummus'],
  'Dairy & Eggs': ['Milk & Cream', 'Eggs', 'Cheese', 'Yogurt', 'Butter & Margarine', 'Refrigerated Dough'],
  Bakery: ['Bread', 'Rolls & Buns', 'Pastries & Desserts', 'Bakery Tortillas / Flatbreads'],
  'Pantry / Dry Grocery': [
    'Canned & Jarred',
    'Pasta, Rice & Grains',
    'Sauces & Condiments',
    'Baking',
    'Cereal & Breakfast',
    'Snacks',
    'Spices & Seasonings',
    'Oils & Vinegars',
    'Nut Butters & Spreads',
    'Soups & Broth',
    'International'
  ],
  Frozen: ['Vegetables', 'Fruit', 'Meals & Entrées', 'Pizza', 'Breakfast', 'Appetizers & Snacks', 'Meat & Seafood', 'Ice Cream & Desserts'],
  Beverages: ['Water', 'Soda', 'Juice', 'Coffee & Tea', 'Sports & Energy Drinks'],
  Household: ['Paper Products', 'Cleaning', 'Laundry', 'Dishwashing', 'Food Storage & Foil', 'Trash Bags'],
  'Health & Personal Care': ['Toiletries', 'Oral Care', 'Hair & Skin Care', 'OTC Medicine', 'First Aid', 'Feminine Care'],
  Baby: ['Diapers & Wipes', 'Baby Food & Formula', 'Baby Care'],
  Pet: ['Food', 'Treats', 'Litter & Supplies']
};

export const storeSectionsQueryKey = ['store-sections'] as const;

export interface EffectiveStorePlacement {
  department: string;
  subSection: string | null;
  departmentProvenance: PlacementProvenance;
  subSectionProvenance: PlacementProvenance;
}

export interface StoreDepartmentGroup {
  department: string;
  items: ShoppingListItem[];
  subdivided: boolean;
  subSections: Array<{ name: string; items: ShoppingListItem[] }>;
  remainder: ShoppingListItem[];
}

function clean(value: unknown) {
  return String(value || '').trim();
}

function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function canonicalDepartment(value: string) {
  const key = normalized(value);
  if (key === 'pantry' || key === 'dry grocery') return 'Pantry / Dry Grocery';
  if (key === 'cleaning & household' || key === 'cleaning and household') return 'Household';
  return DEFAULT_STORE_SECTIONS.find(entry => normalized(entry) === key) || clean(value);
}

const subsectionDepartments = new Map<string, Set<string>>();
Object.entries(DEFAULT_STORE_SUBSECTIONS).forEach(([department, subSections]) => {
  subSections.forEach(subSection => {
    const key = normalized(subSection);
    const values = subsectionDepartments.get(key) || new Set<string>();
    values.add(department);
    subsectionDepartments.set(key, values);
  });
});

function isKnownSubSection(value: string) {
  return subsectionDepartments.has(normalized(value));
}

function isSubSectionCompatible(department: string, subSection: string | null) {
  if (!subSection) return true;
  const departments = subsectionDepartments.get(normalized(subSection));
  if (!departments) return true;
  return departments.has(canonicalDepartment(department));
}

function fallbackPlacement(item: ShoppingListItem): InferredStorePlacement {
  const product = productFor(item);
  const category = normalized(product?.category);
  const name = normalized(product?.name);
  let department = 'Other';
  let subSection: string | null = null;

  if (category === 'frozen' || /\bfrozen\b/.test(name)) {
    department = 'Frozen';
    if (/\bpizza\b/.test(name)) subSection = 'Pizza';
    else if (/\bice cream|gelato|sorbet|popsicle|dessert\b/.test(name)) subSection = 'Ice Cream & Desserts';
    else if (/\bwaffle|pancake|breakfast|hash brown\b/.test(name)) subSection = 'Breakfast';
    else if (/\bpea|corn|broccoli|spinach|bean|carrot|vegetable|cauliflower|edamame\b/.test(name)) subSection = 'Vegetables';
    else if (/\bstrawberry|blueberry|berry|berries|mango|pineapple|fruit\b/.test(name)) subSection = 'Fruit';
    else subSection = 'Meals & Entrées';
  } else if (['produce', 'fruit', 'fruits', 'vegetable', 'vegetables', 'herbs'].includes(category)) {
    department = 'Produce';
    if (category === 'fruit' || /\bbanana|apple|orange|berry|berries|grape|lemon|lime|avocado|fruit\b/.test(name)) subSection = 'Fruit';
    else if (category === 'herbs' || /\bcilantro|parsley|basil|mint|herb\b/.test(name)) subSection = 'Herbs';
    else subSection = 'Vegetables';
  } else if (['meat & seafood', 'meat and seafood', 'meat', 'seafood'].includes(category)) {
    department = 'Meat & Seafood';
  } else if (['deli', 'deli & prepared foods', 'deli and prepared foods', 'prepared foods'].includes(category)) {
    department = 'Deli & Prepared Foods';
  } else if (['dairy', 'dairy & eggs', 'dairy and eggs', 'eggs', 'milk', 'cheese', 'yogurt'].includes(category)) {
    department = 'Dairy & Eggs';
    if (category === 'eggs' || /\begg(s)?\b/.test(name)) subSection = 'Eggs';
    else if (category === 'cheese' || /\bcheese\b/.test(name)) subSection = 'Cheese';
    else if (category === 'yogurt' || /\byogurt\b/.test(name)) subSection = 'Yogurt';
    else if (/\bmilk|cream|half and half|half & half\b/.test(name)) subSection = 'Milk & Cream';
  } else if (['bakery', 'bread'].includes(category)) {
    department = 'Bakery';
    subSection = 'Bread';
  } else if (['beverages', 'beverage', 'drinks', 'drink'].includes(category)) {
    department = 'Beverages';
  } else if (['cleaning & household', 'cleaning and household', 'household', 'cleaning'].includes(category)) {
    department = 'Household';
  } else if (['health & personal care', 'health and personal care', 'personal care', 'health'].includes(category)) {
    department = 'Health & Personal Care';
  } else if (['baby', 'baby care'].includes(category)) {
    department = 'Baby';
  } else if (['pet', 'pets', 'pet care'].includes(category)) {
    department = 'Pet';
  } else if (['pantry', 'dry grocery', 'snacks', 'condiments & sauces', 'condiments and sauces', 'condiments', 'sauces'].includes(category)) {
    department = 'Pantry / Dry Grocery';
    if (category === 'snacks') subSection = 'Snacks';
    else if (category.includes('condiment') || category.includes('sauce')) subSection = 'Sauces & Condiments';
    else if (/\bpasta|rice|quinoa|grain|noodle\b/.test(name)) subSection = 'Pasta, Rice & Grains';
  }

  return { department, subSection, version: 1 };
}

function resolvePlacement(
  record: StorePlacementRecord | undefined,
  inferred: InferredStorePlacement,
  storeId: string | null
): EffectiveStorePlacement {
  const storeOverride = storeId
    ? record?.storeOverrides.find(entry => entry.storeId === storeId)
    : undefined;
  const baseDepartment = clean(record?.department) || inferred.department || 'Other';
  const baseDepartmentProvenance = record?.departmentProvenance || 'inferred';
  const department = clean(storeOverride?.department) || baseDepartment;
  const departmentProvenance = clean(storeOverride?.department)
    ? (storeOverride?.departmentProvenance || 'store_override')
    : baseDepartmentProvenance;

  const candidates: Array<{ value: string | null; provenance: PlacementProvenance; explicitClear: boolean }> = [];
  if (storeOverride?.subSectionProvenance === 'store_override') {
    candidates.push({
      value: clean(storeOverride.subSection) || null,
      provenance: 'store_override',
      explicitClear: !clean(storeOverride.subSection)
    });
  }
  if (record) {
    candidates.push({
      value: clean(record.subSection) || null,
      provenance: record.subSectionProvenance,
      explicitClear: !clean(record.subSection) && record.subSectionProvenance !== 'inferred'
    });
  }
  candidates.push({ value: inferred.subSection || null, provenance: 'inferred', explicitClear: false });

  let subSection: string | null = null;
  let subSectionProvenance: PlacementProvenance = 'inferred';
  for (const candidate of candidates) {
    if (candidate.explicitClear) {
      subSection = null;
      subSectionProvenance = candidate.provenance;
      break;
    }
    if (!candidate.value) continue;
    if (!isSubSectionCompatible(department, candidate.value)) continue;
    subSection = candidate.value;
    subSectionProvenance = candidate.provenance;
    break;
  }

  return { department, subSection, departmentProvenance, subSectionProvenance };
}

function orderDepartments(left: string, right: string, defaults: string[]) {
  if (left === right) return 0;
  if (left === 'Other') return 1;
  if (right === 'Other') return -1;
  const leftIndex = defaults.indexOf(left);
  const rightIndex = defaults.indexOf(right);
  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
  if (leftIndex >= 0) return -1;
  if (rightIndex >= 0) return 1;
  return left.localeCompare(right);
}

function orderSubSections(department: string, left: string, right: string, suggestions: string[]) {
  const defaults = DEFAULT_STORE_SUBSECTIONS[canonicalDepartment(department)] || [];
  const order = suggestions.length ? suggestions : defaults;
  const leftIndex = order.indexOf(left);
  const rightIndex = order.indexOf(right);
  if (leftIndex >= 0 && rightIndex >= 0) return leftIndex - rightIndex;
  if (leftIndex >= 0) return -1;
  if (rightIndex >= 0) return 1;
  return left.localeCompare(right);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function readLayoutSnapshot(key: string): Record<string, string[]> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as Record<string, string[]> : null;
  } catch {
    return null;
  }
}

function writeLayoutSnapshot(key: string, value: Record<string, string[]>) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Shopping remains usable when session storage is unavailable.
  }
}

function provenanceLabel(value: PlacementProvenance) {
  switch (value) {
    case 'store_override': return 'corrected for this store';
    case 'household_override': return 'corrected for all stores';
    case 'legacy_preserved': return 'preserved from your existing setup';
    default: return 'inferred by Provista';
  }
}

export function useStoreSections(items: ShoppingListItem[] = []) {
  const query = useQuery({ queryKey: storeSectionsQueryKey, queryFn: loadStorePlacements });
  const placementsByItem = useMemo(
    () => new Map((query.data?.placements || []).map(entry => [entry.itemId, entry])),
    [query.data?.placements]
  );

  const recordFor = (item: ShoppingListItem) => {
    const product = productFor(item);
    return product?._id ? placementsByItem.get(product._id) : undefined;
  };

  const inferredPlacementFor = (item: ShoppingListItem) => recordFor(item)?.inferred || fallbackPlacement(item);

  const householdPlacementFor = (item: ShoppingListItem) => {
    const record = recordFor(item);
    return resolvePlacement(record, record?.inferred || fallbackPlacement(item), null);
  };

  const placementFor = (item: ShoppingListItem) => {
    const record = recordFor(item);
    const inferred = record?.inferred || fallbackPlacement(item);
    return resolvePlacement(record, inferred, plannedStoreId(item) || null);
  };

  const suggestionsForDepartment = (department: string) => {
    const direct = query.data?.subSectionsByDepartment?.[department];
    if (direct?.length) return direct;
    const canonical = canonicalDepartment(department);
    return query.data?.subSectionsByDepartment?.[canonical] || DEFAULT_STORE_SUBSECTIONS[canonical] || [];
  };

  const group = (groupItems: ShoppingListItem[], groupKey = ''): StoreDepartmentGroup[] => {
    const departments = new Map<string, Array<{ item: ShoppingListItem; placement: EffectiveStorePlacement }>>();
    groupItems.forEach(item => {
      const placement = placementFor(item);
      const current = departments.get(placement.department) || [];
      current.push({ item, placement });
      departments.set(placement.department, current);
    });

    const structuralSignature = groupItems
      .map(item => {
        const placement = placementFor(item);
        return `${item._id}:${preferredStoreId(item)}:${placement.department}:${placement.subSection || ''}`;
      })
      .sort()
      .join('|');
    const snapshotKey = `provista-store-layout-v1:${stableHash(`${groupKey}|${structuralSignature}`)}`;
    let layout = readLayoutSnapshot(snapshotKey);

    if (!layout) {
      layout = {};
      departments.forEach((entries, department) => {
        const counts = new Map<string, number>();
        entries.forEach(({ placement }) => {
          if (!placement.subSection) return;
          counts.set(placement.subSection, (counts.get(placement.subSection) || 0) + 1);
        });
        const qualifying = [...counts.entries()]
          .filter(([, count]) => count >= 2)
          .map(([name]) => name);
        layout![department] = qualifying.length >= 2
          ? qualifying.sort((left, right) => orderSubSections(department, left, right, suggestionsForDepartment(department)))
          : [];
      });
      writeLayoutSnapshot(snapshotKey, layout);
    }

    const defaults = query.data?.departments?.length ? query.data.departments : [...DEFAULT_STORE_SECTIONS];
    return [...departments.entries()]
      .sort(([left], [right]) => orderDepartments(left, right, defaults))
      .map(([department, entries]) => {
        const headingNames = layout?.[department] || [];
        const subSections = headingNames
          .map(name => ({
            name,
            items: entries.filter(({ placement }) => placement.subSection === name).map(({ item }) => item)
          }))
          .filter(grouped => grouped.items.length > 0);
        const headedNames = new Set(subSections.map(entry => entry.name));
        const remainder = entries
          .filter(({ placement }) => !placement.subSection || !headedNames.has(placement.subSection))
          .map(({ item }) => item);

        return {
          department,
          items: entries.map(({ item }) => item),
          subdivided: subSections.length > 0,
          subSections,
          remainder
        };
      });
  };

  return {
    query,
    recordFor,
    placementFor,
    householdPlacementFor,
    inferredPlacementFor,
    group,
    suggestions: query.data?.departmentSuggestions?.length
      ? query.data.departmentSuggestions
      : [...DEFAULT_STORE_SECTIONS],
    suggestionsForDepartment
  };
}

export function StorePlacementControl({
  item,
  currentPlacement,
  householdPlacement,
  inferredPlacement,
  departmentSuggestions,
  subSectionSuggestionsFor,
  currentStoreId,
  currentStoreName
}: {
  item: ShoppingListItem;
  currentPlacement: EffectiveStorePlacement;
  householdPlacement: EffectiveStorePlacement;
  inferredPlacement: InferredStorePlacement;
  departmentSuggestions: string[];
  subSectionSuggestionsFor: (department: string) => string[];
  currentStoreId: string | null;
  currentStoreName: string;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'household' | 'store'>(currentStoreId ? 'store' : 'household');
  const [department, setDepartment] = useState(currentPlacement.department);
  const [subSection, setSubSection] = useState(currentPlacement.subSection || '');
  const [departmentTouched, setDepartmentTouched] = useState(false);
  const [subSectionTouched, setSubSectionTouched] = useState(false);
  const [clearedSubSection, setClearedSubSection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const product = productFor(item);

  if (!product?._id) return null;

  const baselineFor = (nextScope: 'household' | 'store') =>
    nextScope === 'store' && currentStoreId ? currentPlacement : householdPlacement;

  const seed = (nextScope: 'household' | 'store') => {
    const baseline = baselineFor(nextScope);
    setScope(nextScope);
    setDepartment(baseline.department);
    setSubSection(baseline.subSection || '');
    setDepartmentTouched(false);
    setSubSectionTouched(false);
    setClearedSubSection(null);
  };

  const beginEdit = () => {
    seed(currentStoreId ? 'store' : 'household');
    setOpen(true);
  };

  const close = () => {
    if (saving) return;
    setOpen(false);
    setClearedSubSection(null);
  };

  const changeDepartment = (next: string) => {
    const baseline = baselineFor(scope);
    setDepartment(next);
    setDepartmentTouched(true);
    setClearedSubSection(null);

    if (!subSectionTouched && baseline.subSectionProvenance === 'inferred') {
      const nextCanonical = canonicalDepartment(next);
      const inferredCanonical = canonicalDepartment(inferredPlacement.department);
      setSubSection(nextCanonical === inferredCanonical ? (inferredPlacement.subSection || '') : '');
      return;
    }

    if (subSection && isKnownSubSection(subSection) && !isSubSectionCompatible(next, subSection)) {
      setClearedSubSection(subSection);
      setSubSection('');
      setSubSectionTouched(true);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const nextDepartment = department.trim();
    const nextSubSection = subSection.trim();
    if (!nextDepartment) {
      showToast('Enter a store department', { tone: 'error' });
      return;
    }
    if (nextDepartment.length > 80 || nextSubSection.length > 80) {
      showToast('Keep department and sub-section names to 80 characters or fewer', { tone: 'error' });
      return;
    }

    const baseline = baselineFor(scope);
    const patch: Parameters<typeof updateStorePlacement>[1] = { scope };
    if (scope === 'store' && currentStoreId) patch.storeId = currentStoreId;
    if (departmentTouched && nextDepartment !== baseline.department) patch.department = nextDepartment;
    if (subSectionTouched && nextSubSection !== (baseline.subSection || '')) patch.subSection = nextSubSection || null;
    if (!('department' in patch) && !('subSection' in patch)) {
      close();
      return;
    }

    setSaving(true);
    try {
      await updateStorePlacement(product._id, patch);
      await queryClient.invalidateQueries({ queryKey: storeSectionsQueryKey });
      setOpen(false);
      showToast(
        scope === 'store' && currentStoreId
          ? `${productName(item)} placement updated for ${currentStoreName || 'this store'}`
          : `${productName(item)} placement updated for your household`,
        { tone: 'success' }
      );
    } catch (error) {
      console.error(error);
      showToast('Could not save that shopping placement', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="react-list-section-control"
        aria-label={`Edit shopping placement for ${productName(item)}: ${currentPlacement.department}${currentPlacement.subSection ? `, ${currentPlacement.subSection}` : ''}`}
        onClick={beginEdit}
      >
        <span>Department: {currentPlacement.department}</span>
        {currentPlacement.subSection && <small>Sub-section: {currentPlacement.subSection}</small>}
      </button>

      {open && (
        <div className="react-list-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
          <div
            className="react-list-modal react-store-section-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="react-store-section-title"
            onKeyDown={event => { if (event.key === 'Escape') close(); }}
          >
            <form onSubmit={save}>
              <div className="react-list-modal-heading">
                <div>
                  <p className="react-list-eyebrow">Shopping organization</p>
                  <h2 id="react-store-section-title">Department and sub-section</h2>
                </div>
                <button type="button" className="react-list-modal-close" aria-label="Close shopping placement" onClick={close} disabled={saving}>✕</button>
              </div>

              <p className="react-list-modal-help">
                Correct where you find <strong>{productName(item)}</strong>. Suggested values are optional - type the wording that matches how your household shops.
              </p>

              {currentStoreId && (
                <fieldset className="react-store-placement-scope">
                  <legend>Apply correction to</legend>
                  <label>
                    <input
                      type="radio"
                      name={`store-placement-scope-${item._id}`}
                      value="store"
                      checked={scope === 'store'}
                      onChange={() => seed('store')}
                    />
                    <span>This store{currentStoreName ? ` - ${currentStoreName}` : ''}</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name={`store-placement-scope-${item._id}`}
                      value="household"
                      checked={scope === 'household'}
                      onChange={() => seed('household')}
                    />
                    <span>All stores</span>
                  </label>
                </fieldset>
              )}

              <label htmlFor={`store-department-${item._id}`}>
                <span>Department</span>
                <input
                  id={`store-department-${item._id}`}
                  value={department}
                  onChange={event => changeDepartment(event.target.value)}
                  list={`store-department-suggestions-${item._id}`}
                  role="combobox"
                  aria-autocomplete="list"
                  autoComplete="off"
                  maxLength={80}
                  autoFocus
                />
                <datalist id={`store-department-suggestions-${item._id}`}>
                  {departmentSuggestions.map(value => <option value={value} key={value} />)}
                </datalist>
              </label>

              <label htmlFor={`store-sub-section-${item._id}`}>
                <span>Sub-section <small>optional</small></span>
                <input
                  id={`store-sub-section-${item._id}`}
                  value={subSection}
                  onChange={event => {
                    setSubSection(event.target.value);
                    setSubSectionTouched(true);
                    setClearedSubSection(null);
                  }}
                  list={`store-sub-section-suggestions-${item._id}`}
                  role="combobox"
                  aria-autocomplete="list"
                  autoComplete="off"
                  maxLength={80}
                />
                <datalist id={`store-sub-section-suggestions-${item._id}`}>
                  {subSectionSuggestionsFor(department).map(value => <option value={value} key={value} />)}
                </datalist>
              </label>

              {subSection && (
                <button
                  type="button"
                  className="react-store-placement-clear"
                  onClick={() => {
                    setSubSection('');
                    setSubSectionTouched(true);
                    setClearedSubSection(null);
                  }}
                >
                  Clear sub-section
                </button>
              )}

              {clearedSubSection && (
                <div className="react-store-placement-notice" role="status">
                  <span>{clearedSubSection} is a known sub-section of a different department, so it was cleared from this draft.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSubSection(clearedSubSection);
                      setSubSectionTouched(true);
                      setClearedSubSection(null);
                    }}
                  >
                    Undo
                  </button>
                </div>
              )}

              <small className="react-store-placement-source">
                Department is {provenanceLabel(baselineFor(scope).departmentProvenance)}{baselineFor(scope).subSection ? `; sub-section is ${provenanceLabel(baselineFor(scope).subSectionProvenance)}` : ''}.
              </small>

              <div className="react-list-modal-actions">
                <button type="button" className="shell-button shell-button-secondary" onClick={close} disabled={saving}>Cancel</button>
                <button type="submit" className="shell-button shell-button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save placement'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
