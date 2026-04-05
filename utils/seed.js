const Item = require('../models/Item');
const path = require('path');

async function seedHousehold(householdId) {
  const existing = await Item.countDocuments({ householdId });
  if (existing > 0) return; // already seeded

  const seedData = require(path.join(__dirname, '../seeds/items.json'));
  const items = seedData.map(item => ({ ...item, householdId }));
  await Item.insertMany(items);
  console.log(`Seeded ${items.length} items for household ${householdId}`);
}

module.exports = { seedHousehold };
