# Provista

**A household grocery planning and shopping assistant built for busy families.**

Provista helps a household answer the practical questions that come up every day:

- What are we eating?
- What do we need?
- What are we running low on?
- What should I do next?

It brings meal planning, the shopping list, Pantry, purchase history, and grocery spending into one shared workflow. Price tracking still matters, but it supports the shopping experience instead of being the product's center of gravity.

[![CI](https://github.com/cpPDX/Provista/actions/workflows/ci.yml/badge.svg)](https://github.com/cpPDX/Provista/actions/workflows/ci.yml)

---

## The Product

Provista is designed around the way a household actually moves through groceries rather than around the underlying database.

The main navigation is:

**Home · Plan · List · Pantry · More**

### Home

A lightweight Today view surfaces the things that need attention without making the user hunt through the app:

- tonight's meal
- what is on the shopping list
- low or out Pantry items
- unfinished follow-up, such as prices deferred during shopping

### Plan

Plan meals for the household, keep notes about what a meal needs, reuse favorite meals, repeat meals, handle leftovers, and move needed ingredients toward the shopping list.

### List

Build a shared grocery list manually, through rapid capture, or by scanning a barcode. Items can carry a preferred store and known household pricing so the list can organize a realistic shopping trip without requiring the shopper to manage price data manually.

Checking off an item is optimistic and immediate. Shopping should keep moving even when the network does not.

For purchased items with known history, the shopper can **Use** the expected price, **Update price**, or choose **Later**. Missing prices never block checkout.

### Finish shopping

Completing a trip is the boundary between planning and household history. Provista can:

- move purchased items into Pantry
- record confirmed prices
- update Spending
- remove purchased items from the active list
- preserve deferred prices for later review

The trip's store is chosen once rather than repeated for every item. Known prices stay out of the way unless they need attention.

### Pantry

Pantry supports two levels of tracking:

- **Simple:** Have · Running low · Out
- **Exact:** optional quantities when precision is useful

The simple model is intentional. Provista should still be useful when nobody wants to maintain a perfect inventory database.

### Insights

Prices and Spending live under **More → Insights**. They provide household history and purchasing context without dominating the core navigation.

---

## Product Principles

A few rules guide the implementation:

1. **Household tasks come before administration.** Routine actions should be obvious from their outcome.
2. **Shopping interactions must be fast.** A check-off should never wait for a round trip to the server before visibly succeeding.
3. **Price capture is useful, not mandatory.** The shopper can defer missing or changed prices and keep moving.
4. **External prices are advisory.** A market observation is not proof of what the household paid.
5. **Pantry should tolerate imperfect data.** Simple status tracking is a first-class workflow, not a degraded exact-inventory mode.
6. **Shared household activity should feel collaborative.** Routine List, Pantry, meal, and trip actions should not create unnecessary admin work.

---

## Key Features

- **Home / Today** - parent-oriented summary of meals, shopping, Pantry, and next actions
- **Meal planning** - weekly plans, household participants, notes, favorites, repeat meals, leftovers, and copy-last-week workflows
- **Shared shopping list** - rapid capture, quantities, preferred stores, barcode entry, optimistic check-off, and multi-stop shopping
- **Finish Shopping** - records a completed trip and keeps Pantry, price history, Spend, and the List synchronized
- **Deferred price review** - safely finish a trip with unknown prices and resolve them later from Home
- **Pantry** - simple status or exact quantity tracking, with low/out prioritization
- **Price history** - household-paid prices by item and store, including sales and coupons
- **Spend analytics** - completed-trip totals broken down by month, category, and store
- **External price observations** - optional Open Prices enrichment for reliably matched UPC/store combinations
- **Barcode lookup** - local catalog first, then Open Food Facts for product metadata
- **Households** - Owner/Admin/Member roles, invite codes, QR invites, and shared data
- **Mobile-first UI** - responsive browser application with keyboard, screen-reader, reduced-motion, and iPhone safe-area coverage in CI
- **Offline-aware client** - service worker, IndexedDB support, and queued handling for supported writes

---

## Pricing Data: An Important Boundary

Provista deliberately separates **what the household paid** from **what an external source observed**.

### `PriceEntry`

A `PriceEntry` represents a price the household paid or explicitly submitted. It can feed household price history and, when attached to a completed shopping trip, Spending.

### `PriceObservation`

A `PriceObservation` is advisory data from an external provider. It is useful context, but it never becomes household spending by itself.

The first external provider is [Open Prices](https://prices.openfoodfacts.org/). Provider integration is behind a registry/adapter boundary so additional sources can be added without changing the semantics of shopping trips or household price history.

See [`docs/03-external-pricing.md`](docs/03-external-pricing.md) for the provider contract and matching rules.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20.19+ · Express |
| Database | MongoDB · Mongoose |
| Frontend | Vanilla JavaScript · HTML · CSS |
| Auth | JWT in httpOnly cookies · bcrypt |
| Barcode | ZXing in the browser · Open Food Facts metadata |
| External pricing | Open Prices / Open Food Facts ecosystem |
| API tests | Jest · Supertest · mongodb-memory-server |
| Browser tests | Playwright · Chromium mobile · WebKit/iPhone coverage |
| Deployment | Railway + MongoDB Atlas |

There is no frontend build step. Express serves the browser application directly from `public/`.

---

## Quick Start

### Requirements

- Node.js **20.19 or newer**
- npm
- MongoDB locally or a MongoDB Atlas connection string
- Git

### Install

```bash
git clone https://github.com/cpPDX/Provista.git
cd Provista
npm install
cp .env.example .env
```

Set at least `JWT_SECRET` in `.env`. If you are not running MongoDB locally, also set `MONGODB_URI`.

```env
MONGODB_URI=mongodb://localhost:27017/grocerytracker
PORT=3000
JWT_SECRET=replace-this-with-a-long-random-secret
NODE_ENV=development
APP_BASE_URL=http://localhost:3000
```

Start the app:

```bash
npm start
```

For automatic server reload during development:

```bash
npm run dev
```

Open `http://localhost:3000`.

On first use, register an account and create a household. The household receives a starter grocery catalog and the registering user becomes its Owner.

### Password-reset email

Production password-reset delivery uses Resend:

```env
RESEND_API_KEY=re_...
PASSWORD_RESET_FROM=Provista <no-reply@example.com>
```

### Optional Open Prices configuration

Open Prices read access works without credentials. These variables are optional:

```env
OPEN_PRICES_BASE_URL=https://prices.openfoodfacts.org
OPEN_PRICES_TIMEOUT_MS=5000
OPEN_PRICES_USER_AGENT=Provista/1.0
```

The defaults are suitable for normal development.

---

## Testing

Run the API/unit suite:

```bash
npm test
```

Run only API tests:

```bash
npm run test:api
```

Run Playwright browser tests:

```bash
npm run test:e2e
```

Run Playwright headed while debugging:

```bash
npm run test:e2e:headed
```

GitHub Actions runs syntax checks, the API suite, and critical browser workflows. Browser CI includes mobile Chromium coverage plus targeted WebKit/iPhone accessibility coverage.

---

## Deployment on Railway

Provista is a standard Node service and does not need a frontend build pipeline.

1. Create a MongoDB Atlas database.
2. Connect the repository to a Railway service.
3. Configure the required environment variables:
   - `MONGODB_URI`
   - `JWT_SECRET`
   - `NODE_ENV=production`
   - `APP_BASE_URL` set to the public application origin
4. Configure `RESEND_API_KEY` and `PASSWORD_RESET_FROM` if password-reset email should be delivered.
5. Deploy the desired branch. Railway runs `npm start`.

Railway supplies `PORT`; do not hard-code it in production.

The server begins listening before MongoDB finishes connecting so the process can start cleanly in Railway. Deployment readiness should use:

```text
/api/health/ready
```

---

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `JWT_SECRET` | Yes | - | Signs authentication tokens; server exits if missing |
| `MONGODB_URI` | Production | `mongodb://localhost:27017/grocerytracker` | MongoDB connection string |
| `PORT` | No | `3000` | HTTP port; normally supplied by Railway |
| `NODE_ENV` | No | `development` | Enables production cookie/proxy behavior when set to `production` |
| `APP_BASE_URL` | Recommended | request origin | Origin used in password-reset links |
| `RESEND_API_KEY` | For production reset email | - | Resend API key |
| `PASSWORD_RESET_FROM` | For production reset email | - | Verified reset-email sender |
| `OPEN_PRICES_BASE_URL` | No | `https://prices.openfoodfacts.org` | Open Prices service origin |
| `OPEN_PRICES_TIMEOUT_MS` | No | `5000` | External pricing request timeout |
| `OPEN_PRICES_USER_AGENT` | No | Provista identifier | User-Agent for Open Prices requests |

---

## Roles

| Role | Typical capabilities |
|---|---|
| **Owner** | Full household control, role management, settings, and destructive administrative actions |
| **Admin** | Catalog/store administration, household settings, invites, and optional strict price review |
| **Member** | Routine household work including List, Pantry, meals, item creation, and shopping-trip activity |

Households can enable stricter review for submitted prices without forcing every normal household action through an approval queue.

---

## Architecture at a Glance

```text
Browser / PWA
  public/js + public/css
        │
        ▼
Express routes
  auth · household · grocery · list · trips · pantry
  meals · prices · external prices · spend · sync
        │
        ▼
Service / domain logic
  shopping-trip completion · external pricing adapters
        │
        ▼
Mongoose models
        │
        ▼
MongoDB
```

Important domain records include:

- `Household`, `User`, `HouseholdPerson`
- `Item`, `Store`
- `ShoppingListItem`, `ShoppingTrip`
- `InventoryItem`
- `MealPlan`, `FavoriteMeal`
- `PriceEntry` for household price history
- `PriceObservation` for external advisory prices

The deeper model, route, auth, and data-flow reference lives in [`docs/01-architecture-and-data.md`](docs/01-architecture-and-data.md).

---

## Repository Layout

```text
Provista/
├── server.js                  Express entry point and route mounting
├── models/                    Mongoose domain models
├── routes/                    HTTP API endpoints
├── services/                  Domain services and provider adapters
│   └── externalPricing/       External price provider registry + Open Prices
├── middleware/                Auth, authorization, and security middleware
├── utils/                     Seeding, UPC normalization, category mapping, helpers
├── seeds/                     Starter grocery catalog
├── public/                    Mobile-first browser application
│   ├── index.html
│   ├── login.html
│   ├── sw.js
│   ├── css/
│   └── js/
├── tests/
│   ├── api/                   Jest / Supertest coverage
│   └── e2e/                   Playwright household workflows
├── docs/                      Architecture, external pricing, release guidance
└── .github/workflows/         CI
```

---

## Documentation

- [`docs/01-architecture-and-data.md`](docs/01-architecture-and-data.md) - detailed architecture, data models, routes, and operational behavior
- [`docs/03-external-pricing.md`](docs/03-external-pricing.md) - external price data boundary, provider contract, and Open Prices behavior
- [`docs/release-accessibility-checklist.md`](docs/release-accessibility-checklist.md) - accessibility checks for releases

---

## External Data

Provista currently uses two Open Food Facts ecosystem services for different purposes:

- **Open Food Facts** - product metadata discovered from UPC/EAN barcodes
- **Open Prices** - community-observed market prices used only as shopping context

External data is treated as enrichment. Failure or ambiguity in an external provider should not prevent the household from building a list or completing a shopping trip.

Open Prices / Open Food Facts data carries its own open-data licensing and attribution requirements. See the external pricing documentation before adding exports, redistribution, or another data-combination workflow.

---

## License

Provista is licensed under the **GNU General Public License v3.0**. See [`LICENSE`](LICENSE).
