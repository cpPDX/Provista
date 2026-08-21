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
- **Shopping list** defaults to the household’s usual store, shows price age, and suggests another stop only when the savings matter
- **Spend analytics** break down monthly spend by category and store
- **Pantry status** keeps Have · Running low · Out sustainable without forcing exact cupboard counts
- **Household sharing** trusts routine Pantry and trip activity while reserving approval for standalone member price submissions or an optional strict-review setting

---

## Features

- **Auth & Households** — JWT auth (httpOnly cookies), multi-user households with Owner/Admin/Member roles
- **Invite System** — 6-character invite codes + QR codes; 48-hour expiry, admin-regeneratable
- **Price Tracking** — Log prices per item per store with regular price, sale price, and coupon breakdown; compare stores; view trends over time
- **Household trust** — Normal shopping-trip prices are trusted by default; households can opt into strict admin review
- **Barcode Scanning** — Scan UPC/EAN barcodes to auto-populate item details via Open Food Facts; partial matches let you fill in gaps and save them for future scans
- **Shopping List** — Practical usual-store trip grouping, price freshness, optimistic check-off, and one-step trip completion
- **Spend Analytics** — Monthly spend totals with breakdowns by category and store
- **Pantry** — Have / Running low / Out status and optional exact quantities, editable by every household member
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
- [Node.js 20.19+](https://nodejs.org) — download the LTS version
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
APP_BASE_URL=http://localhost:3000
# Configure these in production to deliver password-reset email:
# RESEND_API_KEY=re_...
# PASSWORD_RESET_FROM=Provista <no-reply@example.com>
```

- `MONGODB_URI` — paste your Atlas connection string from above
- `JWT_SECRET` — any long random string (e.g. `mySuperSecretKey12345abc`); used to sign login tokens
- `PORT` — `3000` works fine locally
- `APP_BASE_URL` — public origin used in password-reset links (for example, `https://provista.example.com`)
- `RESEND_API_KEY` / `PASSWORD_RESET_FROM` — required in production to deliver password-reset email

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
| **Owner** | Everything — manage roles, household settings, and destructive catalog changes |
| **Admin** | Manage catalog/stores, optional strict price review, and invite codes |
| **Member** | Manage the List and routine Pantry status/quantities, add catalog items, and record trusted shopping-trip prices unless strict review is enabled |

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
   - `APP_BASE_URL` — your Railway public URL
   - `RESEND_API_KEY` and `PASSWORD_RESET_FROM` — password-reset delivery credentials
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
| `APP_BASE_URL` | Request origin | Public origin placed in password-reset links |
| `RESEND_API_KEY` | *(none)* | Resend API key; required for production reset-email delivery |
| `PASSWORD_RESET_FROM` | *(none)* | Verified sender used for reset email |

---

## Project Structure

```
├── server.js              # Express server, MongoDB connection
├── models/
│   ├── User.js
│   ├── Household.js
│   ├── HouseholdPerson.js
│   ├── Item.js
│   ├── Store.js
│   ├── PriceEntry.js      # regularPrice, salePrice, couponAmount, finalPrice, pricePerUnit
│   ├── InventoryItem.js
│   ├── ShoppingListItem.js
│   ├── ShoppingTrip.js      # completed trip totals and purchased-item snapshots
│   ├── MealPlan.js          # collaborative weekly household plans
│   └── FavoriteMeal.js      # reusable meals with usual shopping notes
├── routes/
│   ├── auth.js            # Register, login, logout, profile, password
│   ├── household.js       # Members, roles, invite codes, settings
│   ├── items.js
│   ├── stores.js
│   ├── prices.js          # Price CRUD, compare, history, pending approval
│   ├── barcode.js         # UPC lookup via local catalog + Open Food Facts
│   ├── inventory.js
│   ├── shoppingList.js
│   ├── mealPlan.js        # weekly plans, favorites, and copy-last-week
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
        ├── more.js         # Pantry, catalog, stores, household, account
        └── app.js          # Tab navigation + initialization
```

---

## API Reference

```
POST   /api/auth/register             create account
POST   /api/auth/login                login
POST   /api/auth/logout               clear cookie
POST   /api/auth/forgot-password      request an enumeration-safe reset link
POST   /api/auth/reset-password       consume a 30-minute, single-use reset token
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

GET    /api/inventory                 list Pantry items, low/out first
POST   /api/inventory                 add or update a Pantry item (all roles)
PUT    /api/inventory/:id             update status/quantity/notes (all roles)
DELETE /api/inventory/:id             stop tracking a Pantry item (admin+)

GET    /api/shopping-list             list with usual-store, savings, and freshness context
POST   /api/shopping-list             add item to list
POST   /api/shopping-list/complete    complete trip; update Pantry, prices, Spend, list + low stock
PUT    /api/shopping-list/:id         update item (checked, quantity)
DELETE /api/shopping-list/:id         remove item
DELETE /api/shopping-list             clear list (?checkedOnly=true to clear only checked)

GET    /api/spend?month=YYYY-MM       monthly spend breakdown by category + store
GET    /api/spend/summary             monthly totals for the last 6 months
```
