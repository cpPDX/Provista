const express = require('express');
const router = express.Router();
const ShoppingListItem = require('../models/ShoppingListItem');
const PriceEntry = require('../models/PriceEntry');
const mongoose = require('mongoose');

// GET /api/shopping-list - get list with price context
router.get('/', async (req, res) => {
  try {
    const listItems = await ShoppingListItem.find()
      .populate('itemId', 'name category unit')
      .sort({ checked: 1, addedAt: -1 });

    // Attach best price info to each item
    const enriched = await Promise.all(listItems.map(async (li) => {
      const obj = li.toObject();
      if (!li.itemId) return obj;

      // Find the most recent price per store, then pick cheapest
      const priceData = await PriceEntry.aggregate([
        { $match: { itemId: li.itemId._id } },
        { $sort: { date: -1 } },
        {
          $group: {
            _id: '$storeId',
            pricePerUnit: { $first: '$pricePerUnit' },
            price: { $first: '$price' },
            quantity: { $first: '$quantity' },
            date: { $first: '$date' },
            storeId: { $first: '$storeId' }
          }
        },
        { $sort: { pricePerUnit: 1 } },
        { $limit: 1 },
        {
          $lookup: {
            from: 'stores',
            localField: 'storeId',
            foreignField: '_id',
            as: 'store'
          }
        },
        { $unwind: '$store' }
      ]);

      if (priceData.length > 0) {
        obj.bestPrice = {
          pricePerUnit: priceData[0].pricePerUnit,
          price: priceData[0].price,
          quantity: priceData[0].quantity,
          store: priceData[0].store,
          date: priceData[0].date
        };
      } else {
        obj.bestPrice = null;
      }
      return obj;
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shopping-list
router.post('/', async (req, res) => {
  try {
    const item = new ShoppingListItem(req.body);
    await item.save();
    await item.populate('itemId', 'name category unit');
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/shopping-list/:id
router.put('/:id', async (req, res) => {
  try {
    const item = await ShoppingListItem.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('itemId', 'name category unit');
    if (!item) return res.status(404).json({ error: 'Shopping list item not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/shopping-list (clear entire list)
router.delete('/', async (req, res) => {
  try {
    const { checkedOnly } = req.query;
    if (checkedOnly === 'true') {
      await ShoppingListItem.deleteMany({ checked: true });
    } else {
      await ShoppingListItem.deleteMany({});
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/shopping-list/:id
router.delete('/:id', async (req, res) => {
  try {
    const item = await ShoppingListItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: 'Shopping list item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
