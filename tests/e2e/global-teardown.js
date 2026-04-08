// Runs once after all Playwright tests finish.
// Deletes all test users (email: e2e-*@test.com) and their associated
// household data from the database so tests don't pollute the dev DB.

require('dotenv').config();
const mongoose = require('mongoose');

module.exports = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/grocerytracker';

  await mongoose.connect(uri);

  const User = require('../../models/User');
  const testUsers = await User.find({ email: /^e2e-.*@test\.com$/ }).lean();

  if (testUsers.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const householdIds = [...new Set(testUsers.map(u => u.householdId).filter(Boolean))];
  const userIds = testUsers.map(u => u._id);

  await Promise.all([
    require('../../models/PriceEntry').deleteMany({ householdId: { $in: householdIds } }),
    require('../../models/Item').deleteMany({ householdId: { $in: householdIds } }),
    require('../../models/Store').deleteMany({ householdId: { $in: householdIds } }),
    require('../../models/InventoryItem').deleteMany({ householdId: { $in: householdIds } }),
    require('../../models/ShoppingListItem').deleteMany({ householdId: { $in: householdIds } }),
    require('../../models/MealPlan').deleteMany({ householdId: { $in: householdIds } }),
    require('../../models/Household').deleteMany({ _id: { $in: householdIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);

  console.log(`\n[E2E Teardown] Removed ${testUsers.length} test user(s) and ${householdIds.length} test household(s).`);

  await mongoose.disconnect();
};
