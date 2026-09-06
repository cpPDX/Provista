const INFERENCE_VERSION = 1;

const DEFAULT_DEPARTMENTS = [
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
];

const DEFAULT_SUBSECTIONS = {
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

const PLACEMENT_PROVENANCE = ['inferred', 'household_override', 'store_override', 'legacy_preserved'];

function normalize(value) {
  return String(value || '').trim();
}

function normalized(value) {
  return normalize(value).toLowerCase().replace(/\s+/g, ' ');
}

function canonicalDepartment(value) {
  const key = normalized(value);
  if (key === 'pantry') return 'Pantry / Dry Grocery';
  if (key === 'dry grocery') return 'Pantry / Dry Grocery';
  if (key === 'cleaning & household' || key === 'cleaning and household') return 'Household';
  return DEFAULT_DEPARTMENTS.find(entry => normalized(entry) === key) || normalize(value);
}

const subsectionDepartments = new Map();
for (const [department, subsections] of Object.entries(DEFAULT_SUBSECTIONS)) {
  for (const subsection of subsections) {
    const key = normalized(subsection);
    const current = subsectionDepartments.get(key) || new Set();
    current.add(department);
    subsectionDepartments.set(key, current);
  }
}

function isKnownSubSection(value) {
  return subsectionDepartments.has(normalized(value));
}

function isSubSectionCompatible(department, subsection) {
  if (!normalize(subsection)) return true;
  const allowed = subsectionDepartments.get(normalized(subsection));
  if (!allowed) return true;
  return allowed.has(canonicalDepartment(department));
}

function has(text, pattern) {
  return pattern.test(text);
}

function inferDepartment(item = {}) {
  const category = normalized(item.category);
  const name = normalized(item.name);
  const combined = `${category} ${name}`;

  if (category === 'frozen' || has(name, /\bfrozen\b/)) return 'Frozen';
  if (['produce', 'fruit', 'fruits', 'vegetable', 'vegetables', 'herbs'].includes(category)) return 'Produce';
  if (['meat & seafood', 'meat and seafood', 'meat', 'seafood', 'beef', 'pork', 'chicken', 'turkey'].includes(category)) return 'Meat & Seafood';
  if (['deli', 'deli & prepared foods', 'deli and prepared foods', 'prepared foods'].includes(category)) return 'Deli & Prepared Foods';
  if (['dairy', 'dairy & eggs', 'dairy and eggs', 'eggs', 'milk', 'cheese', 'yogurt'].includes(category)) return 'Dairy & Eggs';
  if (['bakery', 'bread'].includes(category)) return 'Bakery';
  if (['beverages', 'beverage', 'drinks', 'drink'].includes(category)) return 'Beverages';
  if (['cleaning & household', 'cleaning and household', 'household', 'cleaning'].includes(category)) return 'Household';
  if (['health & personal care', 'health and personal care', 'personal care', 'health'].includes(category)) return 'Health & Personal Care';
  if (['baby', 'baby care'].includes(category)) return 'Baby';
  if (['pet', 'pets', 'pet care'].includes(category)) return 'Pet';
  if (['pantry', 'dry grocery', 'snacks', 'condiments & sauces', 'condiments and sauces', 'condiments', 'sauces', 'baking', 'cereal'].includes(category)) return 'Pantry / Dry Grocery';

  if (has(combined, /\b(diaper|baby wipes|formula|baby food)\b/)) return 'Baby';
  if (has(combined, /\b(cat food|dog food|pet food|cat litter|dog treat|cat treat)\b/)) return 'Pet';
  if (has(combined, /\b(shampoo|conditioner|toothpaste|toothbrush|deodorant|ibuprofen|acetaminophen|bandage|tampon|pads)\b/)) return 'Health & Personal Care';
  if (has(combined, /\b(detergent|dish soap|paper towel|toilet paper|trash bag|foil|plastic wrap|cleaner)\b/)) return 'Household';
  if (has(combined, /\b(soda|juice|coffee|tea|water|energy drink|sports drink)\b/)) return 'Beverages';

  return 'Other';
}

function inferProduceSubSection(name) {
  if (has(name, /\b(banana|apple|orange|berry|berries|grape|lemon|lime|avocado|watermelon|pineapple|melon|peach|pear|plum|mango|kiwi|fruit)\b/)) return 'Fruit';
  if (has(name, /\b(cilantro|parsley|basil|mint|rosemary|thyme|herb)\b/)) return 'Herbs';
  if (has(name, /\b(salad|slaw|greens mix|packaged produce|cut fruit|cut vegetable)\b/)) return 'Salad & Packaged Produce';
  return 'Vegetables';
}

function inferFrozenSubSection(name) {
  if (has(name, /\b(pizza|flatbread pizza)\b/)) return 'Pizza';
  if (has(name, /\b(ice cream|gelato|sorbet|popsicle|frozen dessert|cheesecake)\b/)) return 'Ice Cream & Desserts';
  if (has(name, /\b(waffle|pancake|breakfast|hash brown)\b/)) return 'Breakfast';
  if (has(name, /\b(appetizer|snack|pizza roll|mozzarella stick|taquito|egg roll)\b/)) return 'Appetizers & Snacks';
  if (has(name, /\b(chicken|beef|pork|shrimp|salmon|fish|meat|seafood)\b/)) return 'Meat & Seafood';
  if (has(name, /\b(strawberry|blueberry|berry|berries|mango|pineapple|peach|fruit)\b/)) return 'Fruit';
  if (has(name, /\b(peas?|corn|broccoli|spinach|beans?|carrots?|vegetables?|cauliflower|edamame)\b/)) return 'Vegetables';
  return 'Meals & Entrées';
}

function inferPantrySubSection(item, name, category) {
  const unit = normalized(item.unit);
  if (category === 'snacks' || has(name, /\b(chip|cracker|pretzel|popcorn|snack|cookie)\b/)) return 'Snacks';
  if (category.includes('condiment') || category.includes('sauce') || has(name, /\b(ketchup|mustard|mayonnaise|mayo|sauce|salsa|hot sauce|soy sauce)\b/)) return 'Sauces & Condiments';
  if (unit === 'can' || has(name, /\b(canned|jarred|beans|tomato paste|tomato sauce|pickle|olives)\b/)) return 'Canned & Jarred';
  if (has(name, /\b(pasta|spaghetti|macaroni|rice|quinoa|barley|grain|noodle|couscous)\b/)) return 'Pasta, Rice & Grains';
  if (has(name, /\b(flour|sugar|baking soda|baking powder|cornstarch|chocolate chip|cake mix|brownie mix)\b/)) return 'Baking';
  if (has(name, /\b(cereal|oatmeal|granola|breakfast bar)\b/)) return 'Cereal & Breakfast';
  if (has(name, /\b(spice|seasoning|peppercorn|paprika|cumin|cinnamon|oregano|garlic powder)\b/)) return 'Spices & Seasonings';
  if (has(name, /\b(oil|vinegar)\b/)) return 'Oils & Vinegars';
  if (has(name, /\b(peanut butter|almond butter|nut butter|jam|jelly|preserves|spread)\b/)) return 'Nut Butters & Spreads';
  if (has(name, /\b(soup|broth|stock)\b/)) return 'Soups & Broth';
  if (has(name, /\b(tortilla|naan|ramen|curry|tahini|miso|international)\b/)) return 'International';
  return null;
}

function inferSubSection(item = {}, department) {
  const name = normalized(item.name);
  const category = normalized(item.category);

  switch (department) {
    case 'Produce':
      if (category === 'fruit' || category === 'fruits') return 'Fruit';
      if (category === 'herbs') return 'Herbs';
      return inferProduceSubSection(name);
    case 'Meat & Seafood':
      if (has(name, /\bbeef|steak|ground beef\b/)) return 'Beef';
      if (has(name, /\bpork|ham\b/)) return 'Pork';
      if (has(name, /\bchicken|turkey\b/)) return 'Chicken & Turkey';
      if (has(name, /\bshrimp|salmon|fish|seafood|tuna|cod\b/)) return 'Seafood';
      if (has(name, /\bsausage|bacon\b/)) return 'Sausage & Bacon';
      if (has(name, /\btofu|tempeh|plant[- ]based|meatless\b/)) return 'Plant-based Proteins';
      return null;
    case 'Deli & Prepared Foods':
      if (has(name, /\brotisserie\b/)) return 'Rotisserie';
      if (has(name, /\bhummus|dip\b/)) return 'Dips & Hummus';
      if (has(name, /\bcheese\b/)) return 'Deli Cheese';
      if (has(name, /\bham|turkey|salami|deli meat\b/)) return 'Deli Meat';
      return 'Prepared Meals';
    case 'Dairy & Eggs':
      if (category === 'eggs' || has(name, /\begg(s)?\b/)) return 'Eggs';
      if (category === 'cheese' || has(name, /\bcheese\b/)) return 'Cheese';
      if (category === 'yogurt' || has(name, /\byogurt\b/)) return 'Yogurt';
      if (has(name, /\bbutter|margarine\b/)) return 'Butter & Margarine';
      if (has(name, /\bdough|biscuit dough|crescent roll\b/)) return 'Refrigerated Dough';
      if (category === 'milk' || has(name, /\bmilk|cream|half and half|half & half\b/)) return 'Milk & Cream';
      return null;
    case 'Bakery':
      if (has(name, /\broll|bun\b/)) return 'Rolls & Buns';
      if (has(name, /\bpastry|cake|pie|donut|doughnut|dessert\b/)) return 'Pastries & Desserts';
      if (has(name, /\btortilla|flatbread\b/)) return 'Bakery Tortillas / Flatbreads';
      return 'Bread';
    case 'Pantry / Dry Grocery':
      return inferPantrySubSection(item, name, category);
    case 'Frozen':
      return inferFrozenSubSection(name);
    case 'Beverages':
      if (has(name, /\bwater\b/)) return 'Water';
      if (has(name, /\bsoda|cola|sparkling soda\b/)) return 'Soda';
      if (has(name, /\bjuice\b/)) return 'Juice';
      if (has(name, /\bcoffee|tea\b/)) return 'Coffee & Tea';
      if (has(name, /\benergy drink|sports drink|electrolyte\b/)) return 'Sports & Energy Drinks';
      return null;
    case 'Household':
      if (has(name, /\bpaper towel|toilet paper|napkin|tissue\b/)) return 'Paper Products';
      if (has(name, /\blaundry|detergent|fabric softener|dryer sheet\b/)) return 'Laundry';
      if (has(name, /\bdish soap|dishwasher|dishwashing\b/)) return 'Dishwashing';
      if (has(name, /\bfoil|plastic wrap|food storage|zip bag|storage bag\b/)) return 'Food Storage & Foil';
      if (has(name, /\btrash bag|garbage bag\b/)) return 'Trash Bags';
      return 'Cleaning';
    case 'Health & Personal Care':
      if (has(name, /\btoothpaste|toothbrush|floss|mouthwash\b/)) return 'Oral Care';
      if (has(name, /\bshampoo|conditioner|lotion|skin|hair\b/)) return 'Hair & Skin Care';
      if (has(name, /\bibuprofen|acetaminophen|medicine|antacid|allergy\b/)) return 'OTC Medicine';
      if (has(name, /\bbandage|gauze|first aid|antiseptic\b/)) return 'First Aid';
      if (has(name, /\btampon|feminine|menstrual|sanitary pad\b/)) return 'Feminine Care';
      return 'Toiletries';
    case 'Baby':
      if (has(name, /\bdiaper|wipe\b/)) return 'Diapers & Wipes';
      if (has(name, /\bformula|baby food\b/)) return 'Baby Food & Formula';
      return 'Baby Care';
    case 'Pet':
      if (has(name, /\btreat\b/)) return 'Treats';
      if (has(name, /\blitter|toy|leash|supply|supplies\b/)) return 'Litter & Supplies';
      return 'Food';
    default:
      return null;
  }
}

function inferStorePlacement(item = {}) {
  const department = inferDepartment(item);
  const subSection = inferSubSection(item, department);
  return { department, subSection, version: INFERENCE_VERSION };
}

function applyStorePlacementInference(item) {
  const before = JSON.stringify({
    storeDepartment: item.storeDepartment || null,
    storeSubSection: item.storeSubSection || null,
    storeDepartmentProvenance: item.storeDepartmentProvenance || null,
    storeSubSectionProvenance: item.storeSubSectionProvenance || null,
    storePlacementInferenceVersion: item.storePlacementInferenceVersion || null
  });
  const inferred = inferStorePlacement(item);
  const legacySection = normalize(item.storeSection);

  if (!item.storeDepartmentProvenance) {
    if (normalize(item.storeDepartment)) {
      item.storeDepartmentProvenance = 'legacy_preserved';
    } else if (legacySection) {
      item.storeDepartment = legacySection;
      item.storeDepartmentProvenance = 'legacy_preserved';
    } else {
      item.storeDepartment = inferred.department;
      item.storeDepartmentProvenance = 'inferred';
    }
  }

  if (item.storeDepartmentProvenance === 'inferred') {
    item.storeDepartment = inferred.department;
  }

  if (!item.storeSubSectionProvenance) {
    if (normalize(item.storeSubSection)) {
      item.storeSubSectionProvenance = 'legacy_preserved';
    } else {
      item.storeSubSection = isSubSectionCompatible(item.storeDepartment, inferred.subSection)
        ? inferred.subSection
        : null;
      item.storeSubSectionProvenance = 'inferred';
    }
  }

  if (item.storeSubSectionProvenance === 'inferred') {
    item.storeSubSection = isSubSectionCompatible(item.storeDepartment, inferred.subSection)
      ? inferred.subSection
      : null;
  }

  item.storePlacementInferenceVersion = INFERENCE_VERSION;

  const after = JSON.stringify({
    storeDepartment: item.storeDepartment || null,
    storeSubSection: item.storeSubSection || null,
    storeDepartmentProvenance: item.storeDepartmentProvenance || null,
    storeSubSectionProvenance: item.storeSubSectionProvenance || null,
    storePlacementInferenceVersion: item.storePlacementInferenceVersion || null
  });
  return before !== after;
}

function resolveStorePlacement(item, storeId = null) {
  const inferred = inferStorePlacement(item);
  const effectiveStoreId = normalize(storeId);
  const overrides = Array.isArray(item.storePlacementOverrides) ? item.storePlacementOverrides : [];
  const storeOverride = effectiveStoreId
    ? overrides.find(entry => normalize(entry.storeId?._id || entry.storeId) === effectiveStoreId)
    : null;

  const baseDepartment = normalize(item.storeDepartment) || inferred.department || 'Other';
  const baseDepartmentProvenance = item.storeDepartmentProvenance || 'inferred';
  const department = normalize(storeOverride?.department) || baseDepartment;
  const departmentProvenance = normalize(storeOverride?.department)
    ? (storeOverride.departmentProvenance || 'store_override')
    : baseDepartmentProvenance;

  const candidates = [];
  if (storeOverride?.subSectionProvenance === 'store_override') {
    candidates.push({
      value: normalize(storeOverride.subSection) || null,
      provenance: 'store_override',
      explicitClear: !normalize(storeOverride.subSection)
    });
  }
  if (item.storeSubSectionProvenance) {
    candidates.push({
      value: normalize(item.storeSubSection) || null,
      provenance: item.storeSubSectionProvenance,
      explicitClear: !normalize(item.storeSubSection) && item.storeSubSectionProvenance !== 'inferred'
    });
  }
  candidates.push({ value: inferred.subSection || null, provenance: 'inferred', explicitClear: false });

  let subSection = null;
  let subSectionProvenance = 'inferred';
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

  return {
    department,
    subSection,
    departmentProvenance,
    subSectionProvenance,
    inferred
  };
}

module.exports = {
  INFERENCE_VERSION,
  DEFAULT_DEPARTMENTS,
  DEFAULT_SUBSECTIONS,
  PLACEMENT_PROVENANCE,
  normalize,
  canonicalDepartment,
  isKnownSubSection,
  isSubSectionCompatible,
  inferStorePlacement,
  applyStorePlacementInference,
  resolveStorePlacement
};
