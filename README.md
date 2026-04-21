# Provista

A browser-based grocery price tracker for households — log prices, scan barcodes, compare stores, and see where your grocery budget is actually going.

---

## The Problem

Grocery prices change constantly, vary by store, and go on sale in unpredictable cycles. Most people have no idea whether the price they're paying for something is good, bad, or they missed a sale last week. And when you're shopping for a household, that knowledge lives in one person's head (if anywhere).

**Common frustrations:**
- "Was this cheaper at the other store?"
- "I think this went on sale recently but I can't remember the price"
- "We already have three of those at home — why did you buy more?"
- "How much are we actually spending on groceries each month?"

## How We're Solving It

Provista gives households a shared, running log of prices — tied to specific stores, with sale prices, coupon tracking, and a price-per-unit breakdown so you can compare apples to apples (literally).

- **Barcode scanning** captures item details without manual entry
- **Shopping list** shows the best-known price and which store to go to for each item
- **Spend analytics** break down monthly spend by category and store
- **Inventory tracking** prevents over-buying
- **Household sharing** with roles means everyone in the house has the same information, and a lightweight approval flow keeps the data clean when non-admin members submit prices

---

## Features

- **Auth & Households** — JWT auth (httpOnly cookies), multi-user households with Owner/Admin/Member roles
- **Invite System** — 6-character invite codes + QR codes; 48-hour expiry, admin-regeneratable
- **Price Tracking** — Log prices per item per store with regular price, sale price, and coupon breakdown; compare stores; view trends over time
- **Pending Approval** — Members submit prices for admin review; admins see a badge and inline review queue
- **Barcode Scanning** — Scan UPC/EAN barcodes to auto-populate item details via Open Food Facts; partial matches let you fill in gaps and save them for future scans
- **Shopping List** — Persistent list with best-price-per-store suggestions and "added by" attribution
- **Spend Analytics** — Monthly spend totals with breakdowns by category and store
- **Inventory** — Basic in-stock tracking with quantity management (admin only)
- **Item Catalog** — ~200 seeded common US grocery items per household; fully editable
- **Account Settings** — Each user can update their name, email, and password

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: MongoDB (Atlas free tier or local)
- **Frontend**: Vanilla HTML/CSS/JavaScript — mobile-first, no frameworks, no build step
- **Barcode**: ZXing (client-side, loaded on demand from CDN) + Open Food Facts public API
- **Auth**: JWT stored in httpOnly cookies, bcrypt password hashing

---

## Setup

### What You Need

**Sign up for (both free):**
- [MongoDB Atlas](https://www.mongodb.com/atlas) — free M0 cluster for the database
- [Railway](https://railway.app) — only if you want to host it online (optional; local is fine for home use)

**Install on your PC:**
- [Node.js 18+](https://nodejs.org) — download the LTS version
- [Git](https://git-scm.com) — to clone the repo

---

### MongoDB Atlas Setup

1. Create a free account at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a new project and click **Build a Cluster** → choose **M0 Free Tier**
3. Under **Database Access**: add a user with a username and password
4. Under **Network Access**: add your IP address (or `0.0.0.0/0` to allow any IP while testing)
5. Go to your cluster → **Connect** → **Drivers** → copy the connection string

It looks like:
```
mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

Add `/provista` before the `?` to set the database name:
```
mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/provista?retryWrites=true&w=majority
```

---

### Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/cppdx/provista.git
cd provista

# 2. Install dependencies
npm install

# 3. Create environment file
```

Create a `.env` file in the project root:

```env
MONGODB_URI=mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/provista?retryWrites=true&w=majority
JWT_SECRET=any-long-random-string-you-make-up
PORT=3000
```

- `MONGODB_URI` — paste your Atlas connection string from above
- `JWT_SECRET` — any long random string (e.g. `mySuperSecretKey12345abc`); used to sign login tokens
- `PORT` — `3000` works fine locally

```bash
# 4. Start the server
npm start

# Or with auto-reload during development:
npm run dev
```

Open **http://localhost:3000** in your browser.

**First run:** Register an account → Create a household. You'll be the Owner and ~200 seed grocery items load automatically.

---

### Use It on Your Phone (Same Wi-Fi)

Find your PC's local IP address (e.g. `192.168.1.50`) and open `http://192.168.1.50:3000` on your phone's browser. It's mobile-first and works well as a pinned web app — use "Add to Home Screen" from your browser menu.

---

### Invite Household Members

1. Go to **More → Household → Show Invite Code & QR**
2. Share the 6-character code or QR code with family members
3. They open the app, register, and enter the code to join your household
4. New members start as **Member** role — owners can promote to Admin

---

## Roles

| Role | Can do |
|------|--------|
| **Owner** | Everything — manage roles, rename household, approve/reject prices |
| **Admin** | Approve prices, manage inventory/catalog/stores, view invite codes |
| **Member** | Submit prices (pending admin review), manage shopping list, view data |

---

## Deployment on Railway

1. **Atlas setup** — follow the MongoDB Atlas steps above; whitelist `0.0.0.0/0` since Railway IPs are dynamic

2. **Deploy to Railway**
   - Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
   - Select this repository — Railway auto-detects Node.js and runs `npm start`

3. **Set environment variables in Railway**
   - `MONGODB_URI` — your Atlas connection string
   - `JWT_SECRET` — your secret string
   - `NODE_ENV` — set to `production` (enables secure cookies)
   - `PORT` is injected automatically; don't set it manually

4. Push to the connected branch — Railway deploys automatically and gives you a public URL

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URI` | `mongodb://localhost:27017/provista` | MongoDB connection string |
| `PORT` | `3000` | HTTP port (auto-set by Railway) |
| `JWT_SECRET` | *(required)* | Long random secret for signing JWTs |
| `NODE_ENV` | `development` | Set to `production` for secure cookies |

---

## Project Structure

```
├── server.js              # Express server, MongoDB connection
├── models/
│   ├── User.js
│   ├── Household.js
│   ├── Item.js
│   ├── Store.js
│   ├── PriceEntry.js      # regularPrice, salePrice, couponAmount, finalPrice, pricePerUnit
│   ├── InventoryItem.js
│   └── ShoppingListItem.js
├── routes/
│   ├── auth.js            # Register, login, logout, profile, password
│   ├── household.js       # Members, roles, invite codes, settings
│   ├── items.js
│   ├── stores.js
│   ├── prices.js          # Price CRUD, compare, history, pending approval
│   ├── barcode.js         # UPC lookup via local catalog + Open Food Facts
│   ├── inventory.js
│   ├── shoppingList.js
│   └── spend.js
├── middleware/
│   └── auth.js            # requireAuth, requireAdmin, requireOwner
├── utils/
│   ├── seed.js            # seedHousehold() — called on household creation
│   ├── upc.js             # UPC-A / EAN-13 / UPC-E normalization
│   └── categoryMap.js     # Open Food Facts → local category mapping
├── seeds/
│   └── items.json         # ~200 seeded grocery items
├── scripts/
│   └── backfill-upcs.js   # One-time UPC backfill for seeded items
└── public/
    ├── index.html
    ├── login.html
    ├── css/
    │   ├── style.css
    │   └── auth.css
    └── js/
        ├── api.js          # Fetch wrapper for all API calls
        ├── auth.js         # window.appAuth singleton
        ├── ui.js           # Shared utilities, formatting, charting
        ├── autocomplete.js # Reusable item + store autocomplete
        ├── scanner.js      # Barcode scanner (ZXing) + confirmation flow
        ├── prices.js       # Price log tab
        ├── shoppingList.js # Shopping list tab
        ├── spend.js        # Analytics tab
        ├── more.js         # Inventory, catalog, stores, household, account
        └── app.js          # Tab navigation + initialization
```

---

## API Reference

```
POST   /api/auth/register             create account
POST   /api/auth/login                login
POST   /api/auth/logout               clear cookie
GET    /api/auth/me                   current user + household + feature flags
PUT    /api/auth/profile              update name/email/barcode preference
PUT    /api/auth/password             change password

GET    /api/household                 members list
PUT    /api/household                 rename household (owner only)
PATCH  /api/household/settings        update household settings (admin+)
GET    /api/household/invite          get current invite code + QR data
POST   /api/household/invite          regenerate invite code
DELETE /api/household/members/:id     remove member
PUT    /api/household/members/:id     update member role

GET    /api/items                     list items (search param supported)
POST   /api/items                     create item
PUT    /api/items/:id                 update item
DELETE /api/items/:id                 delete item

GET    /api/stores                    list stores
POST   /api/stores                    create store
PUT    /api/stores/:id                update store
DELETE /api/stores/:id                delete store

GET    /api/prices                    list price entries
POST   /api/prices                    create price entry
PUT    /api/prices/:id/approve        approve + optionally edit a pending entry
DELETE /api/prices/:id/reject         reject a pending entry
GET    /api/prices/pending            list pending entries (admin+)
GET    /api/prices/compare/:itemId    latest approved price per store for an item
GET    /api/prices/history/:itemId    full approved price history for an item
GET    /api/prices/last-purchased/:itemId  most recent approved entry per store

GET    /api/barcode/:upc              look up item by UPC (local catalog, then Open Food Facts)

GET    /api/inventory                 list inventory (quantity > 0)
POST   /api/inventory                 add or update inventory item
PUT    /api/inventory/:id             update quantity/notes
DELETE /api/inventory/:id             remove from inventory

GET    /api/shopping-list             list with best-price context per item
POST   /api/shopping-list             add item to list
PUT    /api/shopping-list/:id         update item (checked, quantity)
DELETE /api/shopping-list/:id         remove item
DELETE /api/shopping-list             clear list (?checkedOnly=true to clear only checked)

GET    /api/spend?month=YYYY-MM       monthly spend breakdown by category + store
GET    /api/spend/summary             monthly totals for the last 6 months
```
