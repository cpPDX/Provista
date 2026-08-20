const HouseholdPerson = require('../models/HouseholdPerson');
const User = require('../models/User');

function fallbackDisplayName(user) {
  if (!user) return '';
  if (user.displayName && user.displayName.trim()) return user.displayName.trim();
  return user.name ? user.name.trim().split(/\s+/)[0] : '';
}

async function ensureHouseholdPeople(householdId) {
  const users = await User.find({ householdId })
    .select('_id name displayName')
    .sort({ createdAt: 1 })
    .lean();

  if (!users.length) return [];

  const existing = await HouseholdPerson.find({ householdId }).lean();
  const byUserId = new Map(existing.filter(p => p.userId).map(p => [String(p.userId), p]));

  const missing = users
    .filter(user => !byUserId.has(String(user._id)))
    .map((user, index) => ({
      householdId,
      userId: user._id,
      displayName: fallbackDisplayName(user),
      sortOrder: existing.length + index
    }));

  if (missing.length) {
    await HouseholdPerson.insertMany(missing, { ordered: false }).catch(err => {
      if (err?.code !== 11000 && !err?.writeErrors?.every(e => e.code === 11000)) throw err;
    });
  }

  return HouseholdPerson.find({ householdId, active: true })
    .sort({ sortOrder: 1, createdAt: 1, displayName: 1 })
    .lean();
}

async function syncUserHouseholdPerson(user) {
  if (!user?.householdId) return null;

  const displayName = fallbackDisplayName(user);
  return HouseholdPerson.findOneAndUpdate(
    { householdId: user.householdId, userId: user._id },
    {
      $set: { displayName, active: true },
      $setOnInsert: { sortOrder: 0 }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

module.exports = { fallbackDisplayName, ensureHouseholdPeople, syncUserHouseholdPerson };
