const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const QRCode = require('qrcode');
const Household = require('../models/Household');
const User = require('../models/User');
const PriceEntry = require('../models/PriceEntry');
const Item = require('../models/Item');
const Store = require('../models/Store');
const InventoryItem = require('../models/InventoryItem');
const ShoppingListItem = require('../models/ShoppingListItem');
const { requireAuth, requireAdmin, requireOwner } = require('../middleware/auth');

// GET /api/household - household info + member list
router.get('/', requireAuth, async (req, res) => {
  try {
    const household = await Household.findById(req.user.householdId).select('-inviteCode -inviteCodeExpiresAt');
    const members = await User.find({ householdId: req.user.householdId }).select('-passwordHash').sort({ createdAt: 1 });
    res.json({ household, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/household - rename household (owner only)
router.put('/', requireAuth, requireOwner, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const household = await Household.findByIdAndUpdate(
      req.user.householdId, { name: name.trim() }, { new: true }
    ).select('-inviteCode -inviteCodeExpiresAt');
    res.json(household);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/household/invite - get invite code and QR data (admin+)
router.get('/invite', requireAuth, requireAdmin, async (req, res) => {
  try {
    const household = await Household.findById(req.user.householdId);
    if (!household) return res.status(404).json({ error: 'Household not found' });
    if (!household.isInviteCodeValid()) {
      // Auto-generate if none/expired
      household.refreshInviteCode();
      await household.save();
    }
    res.json({
      inviteCode: household.inviteCode,
      expiresAt: household.inviteCodeExpiresAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/household/invite/qr - return QR code as PNG image (admin+)
router.get('/invite/qr', requireAuth, requireAdmin, async (req, res) => {
  try {
    const household = await Household.findById(req.user.householdId);
    if (!household) return res.status(404).json({ error: 'Household not found' });
    if (!household.inviteCode || !household.inviteCodeExpiresAt || household.inviteCodeExpiresAt < new Date()) {
      household.refreshInviteCode();
      await household.save();
    }
    const origin = `${req.protocol}://${req.get('host')}`;
    const joinUrl = `${origin}/join?code=${household.inviteCode}`;
    const pngBuffer = await QRCode.toBuffer(joinUrl, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(pngBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/household/invite - regenerate invite code (admin+)
router.post('/invite', requireAuth, requireAdmin, async (req, res) => {
  try {
    const household = await Household.findById(req.user.householdId);
    if (!household) return res.status(404).json({ error: 'Household not found' });
    household.refreshInviteCode();
    await household.save();
    res.json({
      inviteCode: household.inviteCode,
      expiresAt: household.inviteCodeExpiresAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/household/members/:id - remove a member
router.delete('/members/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot remove yourself' });
    }
    const target = await User.findOne({ _id: req.params.id, householdId: req.user.householdId });
    if (!target) return res.status(404).json({ error: 'Member not found' });

    // Admins can only remove members, not other admins/owner
    if (req.user.role === 'admin' && target.role !== 'member') {
      return res.status(403).json({ error: 'Admins can only remove members, not other admins' });
    }
    // Nobody can remove the owner
    if (target.role === 'owner') {
      return res.status(403).json({ error: 'Cannot remove the household owner' });
    }

    await User.findByIdAndUpdate(req.params.id, { householdId: null, role: 'member' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/household/members/:id - update member role (owner only)
router.put('/members/:id', requireAuth, requireOwner, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "member"' });
    }
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
    const target = await User.findOne({ _id: req.params.id, householdId: req.user.householdId });
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(400).json({ error: 'Cannot change owner role' });

    const updated = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-passwordHash');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/household - delete household and all data (owner only)
router.delete('/', requireAuth, requireOwner, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required to confirm deletion' });

    const user = await User.findById(req.user._id);
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Incorrect password' });

    const householdId = req.user.householdId;

    // Cascade delete all household data
    await Promise.all([
      PriceEntry.deleteMany({ householdId }),
      Item.deleteMany({ householdId }),
      Store.deleteMany({ householdId }),
      InventoryItem.deleteMany({ householdId }),
      ShoppingListItem.deleteMany({ householdId }),
      User.updateMany({ householdId }, { $set: { householdId: null, role: 'member' } }),
    ]);
    await Household.findByIdAndDelete(householdId);

    // Clear the owner's auth cookie
    res.clearCookie('token', {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
