const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId).select('-passwordHash');
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (!user.householdId) return res.status(403).json({ error: 'No household assigned' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Middleware to restrict to admin or owner roles
function requireAdmin(req, res, next) {
  if (!['admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or owner role required' });
  }
  next();
}

// Middleware to restrict to owner only
function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner role required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireOwner };
