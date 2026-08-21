const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Household = require('../models/Household');
const HouseholdPerson = require('../models/HouseholdPerson');
const PriceEntry = require('../models/PriceEntry');
const InventoryItem = require('../models/InventoryItem');
const ShoppingListItem = require('../models/ShoppingListItem');
const ShoppingTrip = require('../models/ShoppingTrip');
const { requireSession } = require('../middleware/auth');
const { seedHousehold } = require('../utils/seed');
const { fallbackDisplayName, syncUserHouseholdPerson } = require('../utils/householdPeople');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

const SALT_ROUNDS = 12;
const CLEAR_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production'
};
const COOKIE_OPTS = {
  ...CLEAR_COOKIE_OPTS,
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
};

function issueToken(res, userId) {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, COOKIE_OPTS);
}

function publicUser(user) {
  return {
    _id: user._id,
    name: user.name,
    displayName: fallbackDisplayName(user),
    email: user.email,
    role: user.role,
    householdId: user.householdId,
    preferences: user.preferences
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, action, householdName, inviteCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const trimmedName = name.trim();
    const user = new User({
      name: trimmedName,
      displayName: trimmedName.split(/\s+/)[0],
      email,
      passwordHash
    });

    if (action === 'create') {
      if (!householdName) return res.status(400).json({ error: 'Household name is required' });
      const household = new Household({ name: householdName, ownerId: user._id });
      household.refreshInviteCode();
      await household.save();
      user.householdId = household._id;
      user.role = 'owner';
      await user.save();
      await Promise.all([seedHousehold(household._id), syncUserHouseholdPerson(user)]);
    } else if (action === 'join') {
      if (!inviteCode) return res.status(400).json({ error: 'Invite code is required' });
      const code = inviteCode.toUpperCase().trim();
      const household = await Household.findOne({ inviteCode: code });
      if (!household || !household.isInviteCodeValid()) {
        return res.status(400).json({ error: 'Invalid or expired invite code' });
      }
      user.householdId = household._id;
      user.role = 'member';
      await user.save();
      await syncUserHouseholdPerson(user);
    } else {
      return res.status(400).json({ error: 'Action must be "create" or "join"' });
    }

    issueToken(res, user._id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    if (user.householdId) await syncUserHouseholdPerson(user);
    issueToken(res, user._id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', CLEAR_COOKIE_OPTS);
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', requireSession, async (req, res) => {
  try {
    const user = req.user;
    let household = null;
    if (user.householdId) {
      [household] = await Promise.all([
        Household.findById(user.householdId).select('name ownerId'),
        syncUserHouseholdPerson(user)
      ]);
    }

    const features = {
      offlineAccess: true,
      advancedAnalytics: false,
      barcodeScanning: true
    };

    res.json({ user: publicUser(user), household, features });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// PUT /api/auth/profile - update account/profile fields
router.put('/profile', requireSession, async (req, res) => {
  try {
    const { name, displayName, email, barcodeAutoAccept } = req.body;
    if (name === undefined && displayName === undefined && email === undefined && barcodeAutoAccept === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const update = {};
    if (name !== undefined) {
      const trimmedName = String(name || '').trim();
      if (!trimmedName) return res.status(400).json({ error: 'Name is required' });
      update.name = trimmedName;
    }
    if (displayName !== undefined) {
      const trimmedDisplayName = String(displayName || '').trim();
      if (trimmedDisplayName.length > 60) return res.status(400).json({ error: 'Display name is too long' });
      update.displayName = trimmedDisplayName;
    }
    if (email !== undefined) {
      const normalizedEmail = String(email || '').toLowerCase().trim();
      if (!normalizedEmail) return res.status(400).json({ error: 'Email is required' });
      const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: req.user._id } });
      if (existing) return res.status(409).json({ error: 'Email already in use' });
      update.email = normalizedEmail;
    }
    if (barcodeAutoAccept !== undefined) {
      update['preferences.barcodeAutoAccept'] = barcodeAutoAccept === null ? null : Boolean(barcodeAutoAccept);
    }

    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true }).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.householdId) await syncUserHouseholdPerson(user);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// PUT /api/auth/password - change password
router.put('/password', requireSession, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// DELETE /api/auth/account - permanently delete own account
router.delete('/account', requireSession, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required to confirm deletion' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });

    if (user.role === 'owner' && user.householdId) {
      return res.status(400).json({
        error: 'You are a household owner. Please delete your household or transfer ownership before deleting your account.'
      });
    }

    const userId = user._id;
    const householdId = user.householdId;

    await Promise.all([
      PriceEntry.updateMany(
        { $or: [{ submittedBy: userId }, { reviewedBy: userId }] },
        { $unset: { submittedBy: '', reviewedBy: '' } }
      ),
      InventoryItem.updateMany({ lastUpdatedBy: userId }, { $unset: { lastUpdatedBy: '' } }),
      ShoppingListItem.updateMany(
        { $or: [{ addedBy: userId }, { removedBy: userId }] },
        { $unset: { addedBy: '', removedBy: '' } }
      ),
      ShoppingTrip.updateMany({ completedBy: userId }, { $unset: { completedBy: '' } }),
      householdId
        ? HouseholdPerson.findOneAndUpdate({ householdId, userId }, { $set: { userId: null } })
        : Promise.resolve()
    ]);

    await User.findByIdAndDelete(userId);
    res.clearCookie('token', CLEAR_COOKIE_OPTS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
