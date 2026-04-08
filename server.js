require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const path = require('path');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Auth routes (no auth middleware - these set/clear the cookie)
app.use('/api/auth', require('./routes/auth'));

// Household management
app.use('/api/household', require('./routes/household'));

// Data routes (all require auth via route-level middleware)
app.use('/api/items', require('./routes/items'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/prices', require('./routes/prices'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/shopping-list', require('./routes/shoppingList'));
app.use('/api/spend', require('./routes/spend'));
app.use('/api/meal-plan', require('./routes/mealPlan'));

// Serve login page for /join route (join via QR code link)
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/grocerytracker';

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  // Listen immediately so Railway's health check succeeds while DB connects
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });

  mongoose.connect(MONGODB_URI)
    .then(() => {
      console.log('Connected to MongoDB');
    })
    .catch(err => {
      console.error('MongoDB connection error:', err);
      process.exit(1);
    });
}

module.exports = app;
