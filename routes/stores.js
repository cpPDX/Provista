const express = require('express');
const router = express.Router();
const Store = require('../models/Store');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const isProd = process.env.NODE_ENV === 'production';
function serverErr(err) { return isProd ? 'Internal server error' : err.message; }

function cleanAddress(address) {
  if (!address || typeof address !== 'object') return undefined;
  return {
    street: String(address.street || '').trim(),
    city: String(address.city || '').trim(),
    state: String(address.state || '').trim(),
    postalCode: String(address.postalCode || '').trim(),
    country: String(address.country || 'US').trim() || 'US'
  };
}

function cleanCoordinates(coordinates) {
  if (!coordinates || typeof coordinates !== 'object') return undefined;
  const lat = coordinates.lat === '' || coordinates.lat === null || coordinates.lat === undefined
    ? null : Number(coordinates.lat);
  const lon = coordinates.lon === '' || coordinates.lon === null || coordinates.lon === undefined
    ? null : Number(coordinates.lon);
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw new Error('Invalid store latitude');
  if (lon !== null && (!Number.isFinite(lon) || lon < -180 || lon > 180)) throw new Error('Invalid store longitude');
  return { lat, lon };
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const stores = await Store.find({ householdId: req.user.householdId }).sort({ name: 1 }).lean();
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    if (!req.body.name || !req.body.name.trim()) return res.status(400).json({ error: 'name is required' });
    const store = new Store({
      householdId: req.user.householdId,
      name: req.body.name,
      location: req.body.location,
      address: cleanAddress(req.body.address),
      coordinates: cleanCoordinates(req.body.coordinates)
    });
    await store.save();
    res.status(201).json(store);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const update = {};
    if (req.body.name !== undefined) update.name = req.body.name;
    if (req.body.location !== undefined) update.location = req.body.location;
    if (req.body.address !== undefined) update.address = cleanAddress(req.body.address);
    if (req.body.coordinates !== undefined) update.coordinates = cleanCoordinates(req.body.coordinates);
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
    const store = await Store.findOneAndUpdate(
      { _id: req.params.id, householdId: req.user.householdId },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json(store);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const store = await Store.findOneAndDelete({ _id: req.params.id, householdId: req.user.householdId });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: serverErr(err) });
  }
});

module.exports = router;
