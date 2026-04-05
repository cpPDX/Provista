const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Household = require('../models/Household');
const { seedHousehold } = require('../utils/seed');

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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.json({ user, household });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
});

module.exports = router;
