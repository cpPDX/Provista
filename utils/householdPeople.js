const HouseholdPerson = require('../models/HouseholdPerson');
const User = require('../models/User');

function fallbackDisplayName(user) {
  if (!user) return '';
  if (user.displayName && user.displayName.trim()) return user.displayName.trim();
  return user.name ? user.name.trim().split(/\s+/)[0] : '';
}

async function ensureHouseholdPeople(householdId) {
  const [users, existing] = await Promise.all([
    User.find({ householdId })
      .select('_id name displayName')
      .sort({ createdAt: 1 })
      .lean(),
    HouseholdPerson.find({ householdId }).lean()
  ]);

  const byUserId = new Map(existing.filter(person => person.userId).map(person => [String(person.userId), person]));
  const maxSortOrder = existing.reduce((max, person) => Math.max(max, Number(person.sortOrder) || 0), -1);

  const missing = users
    .filter(user => !byUserId.has(String(user._id)))
    .map((user, index) => ({
      householdId,
      userId: user._id,
      displayName: fallbackDisplayName(user),
      active: true,
      sortOrder: maxSortOrder + index + 1
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
  const existing = await HouseholdPerson.findOne({
    householdId: user.householdId,
    userId: user._id
  });

  if (existing) {
    existing.displayName = displayName;
    existing.active = true;
    return existing.save();
  }

  const last = await HouseholdPerson.findOne({ householdId: user.householdId })
    .sort({ sortOrder: -1 })
    .select('sortOrder')
    .lean();

  try {
    return await HouseholdPerson.create({
      householdId: user.householdId,
      userId: user._id,
      displayName,
      active: true,
      sortOrder: (Number(last?.sortOrder) || 0) + (last ? 1 : 0)
    });
  } catch (err) {
    // Concurrent requests can both discover the same missing link. The unique partial index
    // makes that safe; in that race, return the record created by the other request.
    if (err?.code !== 11000) throw err;
    return HouseholdPerson.findOne({ householdId: user.householdId, userId: user._id });
  }
}

module.exports = { fallbackDisplayName, ensureHouseholdPeople, syncUserHouseholdPerson };
