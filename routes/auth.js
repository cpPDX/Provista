const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Household = require('../models/Household');
const PriceEntry = require('../models/PriceEntry');
const InventoryItem = require('../models/InventoryItem');
const ShoppingListItem = require('../models/ShoppingListItem');
const { seedHousehold } = require('../utils/seed');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

const SALT_ROUNDS = 12;
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
};

function issueToken(res, userId) {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, COOKIE_OPTS);
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
    const user = new User({ name, email, passwordHash });

    if (action === 'create') {
      if (!householdName) return res.status(400).json({ error: 'Household name is required' });
      const household = new Household({ name: householdName, ownerId: user._id });
      household.refreshInviteCode();
      await household.save();
      user.householdId = household._id;
      user.role = 'owner';
      await user.save();
      // Seed items for the new household
      await seedHousehold(household._id);
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
    } else {
      return res.status(400).json({ error: 'Action must be "create" or "join"' });
    }

    issueToken(res, user._id);
    res.status(201).json({
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, householdId: user.householdId }
    });
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

    issueToken(res, user._id);
    res.json({
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, householdId: user.householdId }
    });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTS);
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId).select('-passwordHash');
    if (!user) return res.status(401).json({ error: 'User not found' });

    let household = null;
    if (user.householdId) {
      household = await Household.findById(user.householdId).select('name ownerId');
    }
    // Feature flags — offlineAccess is on for all households for now
    const features = {
      offlineAccess: true,
      advancedAnalytics: false,
      barcodeScanning: true
    };

    res.json({ user, household, features });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
});

// PUT /api/auth/profile - update name and/or email (requires auth cookie)
router.put('/profile', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { name, email, barcodeAutoAccept } = req.body;
    if (name === undefined && email === undefined && barcodeAutoAccept === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const update = {};
    if (name) update.name = name.trim();
    if (email) {
      const existing = await User.findOne({ email: email.toLowerCase(), _id: { $ne: payload.userId } });
      if (existing) return res.status(409).json({ error: 'Email already in use' });
      update.email = email.toLowerCase().trim();
    }
    if (barcodeAutoAccept !== undefined) {
      // null = inherit household, true/false = explicit override
      update['preferences.barcodeAutoAccept'] = barcodeAutoAccept === null ? null : Boolean(barcodeAutoAccept);
    }

    const user = await User.findByIdAndUpdate(payload.userId, update, { new: true }).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

// PUT /api/auth/password - change password (requires auth cookie)
router.put('/password', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = await User.findById(payload.userId);
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
router.delete('/account', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required to confirm deletion' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });

    // Owners must delete or transfer their household before deleting their account
    if (user.role === 'owner' && user.householdId) {
      return res.status(400).json({
        error: 'You are a household owner. Please delete your household or transfer ownership before deleting your account.'
      });
    }

    const userId = user._id;

    // Null out user references in shared data (preserve history for the household)
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
    ]);

    await User.findByIdAndDelete(userId);
    res.clearCookie('token', COOKIE_OPTS);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
