const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Authenticate an account without requiring household membership. Use this for
// account/profile endpoints so a valid user can still manage their account after
// being removed from a household.
async function requireSession(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId).select('-passwordHash');
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// Authenticate and require active household membership for shared-data routes.
async function requireAuth(req, res, next) {
  return requireSession(req, res, () => {
    if (!req.user.householdId) return res.status(403).json({ error: 'No household assigned' });
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!['admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or owner role required' });
  }
  next();
}

function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner role required' });
  }
  next();
}

module.exports = { requireSession, requireAuth, requireAdmin, requireOwner };
