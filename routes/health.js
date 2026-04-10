const express = require('express');
const router = express.Router();

// GET /api/health - lightweight connectivity check, no auth required
router.get('/', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
