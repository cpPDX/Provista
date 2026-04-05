# Grocery Tracker

A browser-based grocery price tracker with household sharing, JWT auth, shopping list, inventory management, receipt scanning, and spend analytics. Runs on mobile.

## Features

- **Auth & Households** — JWT auth (httpOnly cookies), multi-user households with Owner/Admin/Member roles
- **Invite System** — 6-character invite codes + QR codes; 48-hour expiry, admin-regeneratable
- **Price Tracking** — Log prices per item per store, compare stores, view trends over time
- **Pending Approval** — Members submit prices for admin review; admins see badge + review queue
- **Receipt Scanning** — OCR-powered receipt parsing via Tesseract.js (runs entirely in-browser)
- **Shopping List** — Persistent list with best-price-per-store suggestions
- **Spend Analytics** — Monthly spend totals with breakdowns by category and store
- **Inventory** — Basic in-stock tracking with quantity management (admin only)
- **Item Catalog** — ~200 seeded common US grocery items per household; fully editable

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: MongoDB (Atlas or local)
- **Frontend**: Vanilla HTML/CSS/JavaScript (mobile-first, no frameworks)
- **OCR**: Tesseract.js (client-side, no API key needed)

---

## Local Setup

### Prerequisites

- Node.js 18+
- MongoDB running locally, or a MongoDB Atlas connection string

### Steps

```bash
# 1. Clone the repo
git clone https://github.com/cppdx/grocerytracker.git
cd grocerytracker

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Required: set JWT_SECRET to a long random string (e.g. openssl rand -hex 32)
# Optional: set MONGODB_URI if not using localhost

# 4. Start the server
npm start
# or for auto-reload during development:
npm run dev
```

The app will be available at `http://localhost:3000`. Open it and register — the first user creates a household and ~200 seed items are loaded automatically.

### Roles summary

| Role | Can do |
|------|--------|
| **Owner** | Full access + manage admin roles + rename/delete household |
| **Admin** | Approve prices, manage inventory/catalog/stores, view invite codes |
| **Member** | Submit prices (pending review), manage shopping list, view data |

---

## Deployment on Railway

### Prerequisites

- A [Railway](https://railway.app) account
- A [MongoDB Atlas](https://www.mongodb.com/atlas) free-tier cluster

### Steps

1. **MongoDB Atlas setup**
   - Create a free cluster
   - Create a database user with read/write access
   - Whitelist `0.0.0.0/0` in Network Access (Railway IPs are dynamic)
   - Copy the connection string: `mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/grocerytracker?retryWrites=true&w=majority`

2. **Deploy to Railway**
   - Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
   - Select this repository
   - Railway auto-detects Node.js and runs `npm start`

3. **Set environment variables in Railway**
   - `MONGODB_URI` — your Atlas connection string
   - `PORT` — Railway injects this automatically; no need to set it manually

4. **Deploy**
   - Push to the connected branch; Railway deploys automatically
   - The app will be available at your Railway-generated domain

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URI` | `mongodb://localhost:27017/grocerytracker` | MongoDB connection string |
| `PORT` | `3000` | HTTP port (auto-set by Railway) |
| `JWT_SECRET` | *(required)* | Long random secret for signing JWTs |
| `NODE_ENV` | `development` | Set to `production` for secure cookies |

---

## Project Structure

```
├── server.js              # Express server + MongoDB connection + seed logic
├── models/
│   ├── Item.js
│   ├── Store.js
│   ├── PriceEntry.js
│   ├── InventoryItem.js
│   └── ShoppingListItem.js
├── routes/
│   ├── items.js
│   ├── stores.js
│   ├── prices.js
│   ├── inventory.js
│   ├── shoppingList.js
│   └── spend.js
├── seeds/
│   └── items.json         # ~200 seeded grocery items
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── api.js         # Fetch wrapper
        ├── ui.js          # Shared UI utilities + charting
        ├── autocomplete.js
        ├── prices.js
        ├── shoppingList.js
        ├── scan.js
        ├── spend.js
        ├── more.js
        └── app.js         # Tab navigation + init
```

## API Reference

```
GET    /api/items                   list items (search param supported)
POST   /api/items                   create item
PUT    /api/items/:id               update item
DELETE /api/items/:id               delete item

GET    /api/stores                  list stores
POST   /api/stores                  create store
PUT    /api/stores/:id              update store
DELETE /api/stores/:id              delete store

GET    /api/prices                  list price entries (filter: itemId, storeId, startDate, endDate)
POST   /api/prices                  create price entry
DELETE /api/prices/:id              delete price entry
GET    /api/prices/compare/:itemId  latest price per store for an item
GET    /api/prices/history/:itemId  full price history for an item

GET    /api/inventory               list inventory (quantity > 0)
POST   /api/inventory               add or update inventory item
PUT    /api/inventory/:id           update quantity/notes
DELETE /api/inventory/:id           remove from inventory

GET    /api/shopping-list           get list with best-price context per item
POST   /api/shopping-list           add item to list
PUT    /api/shopping-list/:id       update item (checked, quantity)
DELETE /api/shopping-list/:id       remove item
DELETE /api/shopping-list           clear list (add ?checkedOnly=true to clear only checked)

GET    /api/spend?month=YYYY-MM     monthly spend breakdown
GET    /api/spend/summary           monthly totals for last 6 months
```
