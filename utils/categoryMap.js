// Maps Open Food Facts categories_tags prefixes to local GroceryTracker categories.
// Uses prefix matching — checks if any tag in the array starts with a prefix.
// First match wins. Falls back to 'Pantry'.

const MAPPINGS = [
  {
    prefixes: [
      'en:fresh-produce', 'en:fruits', 'en:fresh-fruits', 'en:vegetables',
      'en:fresh-vegetables', 'en:salads', 'en:herbs'
    ],
    category: 'Produce'
  },
  {
    prefixes: [
      'en:meats', 'en:beef', 'en:pork', 'en:poultry', 'en:chicken',
      'en:turkey', 'en:lamb', 'en:fish', 'en:seafood', 'en:shellfish',
      'en:deli-meats'
    ],
    category: 'Meat & Seafood'
  },
  {
    prefixes: [
      'en:dairies', 'en:dairy', 'en:cheeses', 'en:yogurts', 'en:butters',
      'en:creams', 'en:eggs', 'en:milk'
    ],
    category: 'Dairy'
  },
  {
    prefixes: [
      'en:deli', 'en:prepared-meals', 'en:ready-meals'
    ],
    category: 'Deli'
  },
  {
    prefixes: [
      'en:breads', 'en:bakery', 'en:pastries', 'en:muffins',
      'en:bagels', 'en:cakes'
    ],
    category: 'Bakery'
  },
  {
    prefixes: [
      'en:frozen-foods', 'en:frozen-meals', 'en:frozen-vegetables',
      'en:frozen-fruits', 'en:ice-creams'
    ],
    category: 'Frozen'
  },
  {
    prefixes: [
      'en:beverages', 'en:juices', 'en:sodas', 'en:waters', 'en:coffees',
      'en:teas', 'en:beers', 'en:wines'
    ],
    category: 'Beverages'
  },
  {
    prefixes: [
      'en:snacks', 'en:chips', 'en:crackers', 'en:cookies', 'en:candy',
      'en:chocolates', 'en:nuts'
    ],
    category: 'Snacks'
  },
  {
    prefixes: [
      'en:condiments', 'en:sauces', 'en:dressings', 'en:spreads',
      'en:jams', 'en:oils', 'en:vinegars'
    ],
    category: 'Condiments & Sauces'
  },
  {
    prefixes: [
      'en:cleaning', 'en:cleaning-products', 'en:household-products',
      'en:household-supplies', 'en:laundry', 'en:dishwashing'
    ],
    category: 'Cleaning & Household'
  }
];

/**
 * Maps an Open Food Facts categories_tags array to a local category string.
 * @param {string[]} categoriesTags
 * @returns {string}
 */
function mapCategory(categoriesTags) {
  if (!Array.isArray(categoriesTags) || categoriesTags.length === 0) return 'Pantry';

  for (const { prefixes, category } of MAPPINGS) {
    for (const tag of categoriesTags) {
      for (const prefix of prefixes) {
        if (tag.startsWith(prefix)) return category;
      }
    }
  }

  return 'Pantry';
}

module.exports = { mapCategory };
