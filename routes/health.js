const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// GET /api/health - lightweight liveness check, no auth required.
// This only answers whether the Node process is serving requests.
router.get('/', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /api/health/ready - readiness check for deploys/load balancers.
// A process should not receive application traffic until MongoDB is connected.
router.get('/ready', async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      timestamp: new Date().toISOString()
    });
  }

  try {
    await mongoose.connection.db.admin().ping();
    res.json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'not_ready',
      database: 'unavailable',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
