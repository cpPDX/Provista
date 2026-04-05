require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/items', require('./routes/items'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/prices', require('./routes/prices'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/shopping-list', require('./routes/shoppingList'));
app.use('/api/spend', require('./routes/spend'));

// Catch-all: serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Seed database with initial items if collection is empty
async function seedIfEmpty() {
  const Item = require('./models/Item');
  const count = await Item.countDocuments();
  if (count > 0) return;

  const seedData = require('./seeds/items.json');
  await Item.insertMany(seedData);
  console.log(`Seeded ${seedData.length} items into the database.`);
}

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/grocerytracker';
const PORT = process.env.PORT || 3000;

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await seedIfEmpty();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
