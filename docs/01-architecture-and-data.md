# Provista — Architecture & Data Reference

## Project Structure

```
/
├── middleware/
│   └── auth.js                  JWT + role verification
├── models/
│   ├── User.js
│   ├── Household.js
│   ├── Item.js
│   ├── Store.js
│   ├── PriceEntry.js
│   ├── InventoryItem.js
│   ├── ShoppingListItem.js
│   └── MealPlan.js
├── routes/
│   ├── auth.js
│   ├── health.js
│   ├── household.js
│   ├── items.js
│   ├── stores.js
│   ├── prices.js
│   ├── inventory.js
│   ├── shoppingList.js
│   ├── spend.js
│   ├── mealPlan.js
│   ├── admin.js
│   ├── sync.js
│   └── barcode.js
├── utils/
│   ├── categoryMap.js           Open Food Facts → local category mapping
│   ├── seed.js
│   └── upc.js                   UPC normalization (UPC-A/E, EAN-13)
├── scripts/
│   └── backfill-upcs.js
├── seeds/
│   └── items.json               100+ seeded items for new households
├── public/
│   ├── index.html
│   ├── login.html
│   ├── manifest.json
│   ├── sw.js                    Service Worker
│   └── js/
│       ├── app.js               Main initialization
│       ├── auth.js              Client-side auth cache
│       ├── api.js               Offline-aware API wrapper
│       ├── offline.js           IndexedDB + sync queue
│       ├── csvImport.js
│       ├── prices.js
│       ├── shoppingList.js
│       ├── spend.js
│       ├── mealPlan.js
│       ├── scan.js / scanner.js ZXing barcode reading
│       └── vendor/idb.min.js
├── tests/
│   ├── api/                     Jest tests
│   └── e2e/                     Playwright tests
└── server.js                    Express entry point
```

---

## Server Configuration

### Middleware Order

```
express.json({ limit: '10mb' })
cookieParser()
express.static('public')
```

### Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `MONGODB_URI` | `mongodb://localhost:27017/grocerytracker` | MongoDB connection string |
| `JWT_SECRET` | — | **Required — fatal if missing.** Signs 30-day JWTs |
| `NODE_ENV` | `development` | Affects cookie `secure` flag |

### Cookie Configuration

```javascript
{
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000   // 30 days
}
```

---

## Route Mounting Table

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Lightweight connectivity check |
| POST | `/api/auth/register` | — | Create user + household, or join via invite |
| POST | `/api/auth/login` | — | Authenticate user, issue JWT cookie |
| POST | `/api/auth/logout` | — | Clear auth cookie |
| GET | `/api/auth/me` | — | Current user + household + feature flags |
| PUT | `/api/auth/profile` | cookie | Update name/email/barcode preference |
| PUT | `/api/auth/password` | cookie | Change password |
| DELETE | `/api/auth/account` | cookie | Delete own account |
| GET | `/api/household` | auth | Household info + member list |
| PUT | `/api/household` | auth + owner | Rename household |
| PATCH | `/api/household/settings` | auth + admin | Update barcode auto-accept setting |
| GET | `/api/household/invite` | auth + admin | Get invite code + expiry |
| GET | `/api/household/invite/qr` | auth + admin | Invite QR code as PNG |
| POST | `/api/household/invite` | auth + admin | Regenerate invite code |
| DELETE | `/api/household/members/:id` | auth + admin | Remove member |
| PUT | `/api/household/members/:id` | auth + owner | Update member role |
| DELETE | `/api/household` | auth + owner | Delete household + cascade |
| GET | `/api/items` | auth | List / search items |
| POST | `/api/items` | auth + admin | Create item |
| PUT | `/api/items/:id` | auth + admin | Update item |
| POST | `/api/items/:id/merge` | auth + admin | Merge item into target |
| DELETE | `/api/items/:id` | auth + admin | Delete item |
| GET | `/api/stores` | auth | List stores |
| POST | `/api/stores` | auth | Create store (all roles) |
| PUT | `/api/stores/:id` | auth + admin | Update store |
| DELETE | `/api/stores/:id` | auth + admin | Delete store |
| GET | `/api/prices` | auth | List approved prices (filterable) |
| POST | `/api/prices` | auth | Submit price (admin → approved, member → pending) |
| DELETE | `/api/prices/:id` | auth + admin | Delete price entry |
| GET | `/api/prices/pending` | auth + admin | List pending entries |
| PUT | `/api/prices/:id/approve` | auth + admin | Approve with optional edits |
| DELETE | `/api/prices/:id/reject` | auth + admin | Reject pending entry |
| GET | `/api/prices/compare/:itemId` | auth | Latest price per store |
| GET | `/api/prices/history/:itemId` | auth | Approved history + current user's pending |
| GET | `/api/prices/last-purchased/:itemId` | auth | Most recent per store |
| GET | `/api/inventory` | auth + admin | List items with quantity > 0 |
| POST | `/api/inventory` | auth + admin | Create / upsert inventory item |
| PUT | `/api/inventory/:id` | auth + admin | Update inventory item |
| DELETE | `/api/inventory/:id` | auth + admin | Delete inventory item |
| GET | `/api/inventory/low-stock` | auth | Items below threshold |
| GET | `/api/shopping-list` | auth | List with price context |
| POST | `/api/shopping-list` | auth | Add item |
| PUT | `/api/shopping-list/:id` | auth | Update item |
| DELETE | `/api/shopping-list/:id` | auth | Remove item |
| DELETE | `/api/shopping-list` | auth | Clear (all or checked) |
| GET | `/api/spend` | auth | Monthly spend breakdown |
| GET | `/api/spend/summary` | auth | 6-month totals |
| GET | `/api/meal-plan` | auth | Get / scaffold plan for week |
| PUT | `/api/meal-plan` | auth + admin | Save / upsert meal plan |
| GET | `/api/meal-plan/settings` | auth | Get weekStartDay |
| PUT | `/api/meal-plan/settings` | auth + admin | Update weekStartDay |
| POST | `/api/admin/migrate-categories` | auth + admin | Normalize category names |
| GET | `/api/admin/duplicate-groups` | auth + admin | Preview similar items |
| POST | `/api/admin/consolidate-items` | auth + admin | Merge duplicates |
| GET | `/api/sync/bootstrap` | auth | Offline cache population |
| GET | `/api/barcode/:upc` | auth | Lookup barcode locally or via Open Food Facts |
| GET | `/join` | — | Serve login.html for invite links |
| GET | `/*` | — | SPA fallback → index.html |

---

## Auth Flow & Role Permissions

### Server-side Middleware (`middleware/auth.js`)

**`requireAuth`** — Extracts JWT from `req.cookies.token`, verifies with `JWT_SECRET`, fetches User, checks `householdId` exists, attaches to `req.user`. Returns 401 if missing/invalid, 403 if no household.

**`requireAdmin`** — Checks `req.user.role` is `'admin'` or `'owner'`. Returns 403 otherwise.

**`requireOwner`** — Checks `req.user.role` is `'owner'`. Returns 403 otherwise.

Password hashing: bcrypt, `SALT_ROUNDS = 12`.

### Role Permissions

| Action | member | admin | owner |
|---|:---:|:---:|:---:|
| View prices, items, stores | ✓ | ✓ | ✓ |
| Submit price (→ pending) | ✓ | ✓ | ✓ |
| Price auto-approved on submit | | ✓ | ✓ |
| Approve / reject pending prices | | ✓ | ✓ |
| Create/edit/delete items & stores | | ✓ | ✓ |
| Manage inventory | | ✓ | ✓ |
| Change household settings | | ✓ | ✓ |
| Manage invite codes | | ✓ | ✓ |
| Remove members | | ✓ | ✓ |
| Change member roles | | | ✓ |
| Delete household | | | ✓ |

### Register Flow (`POST /api/auth/register`)

**`action: 'create'`**
1. Hash password (bcrypt, 12 rounds)
2. Create Household; set `ownerId`
3. Generate invite code (6-char, 48h validity)
4. Set user `role = 'owner'`
5. Seed 100+ items from `seeds/items.json`
6. Issue JWT (30-day expiry)

**`action: 'join'`**
1. Normalize invite code to uppercase
2. Fetch household by code; validate not expired
3. Set user `role = 'member'`
4. Issue JWT

### Invite System

- Characters: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0`, `O`, `I`, `1`, `L`)
- Length: 6 characters; validity: 48 hours
- Household methods: `refreshInviteCode()`, `isInviteCodeValid()`

### Client-side Auth Cache (`public/js/auth.js`)

`window.appAuth` global:

```javascript
{
  user:          { _id, name, email, role, householdId },
  household:     { name, ownerId },
  features:      { offlineAccess, advancedAnalytics, barcodeScanning },
  offlineSession: false   // true when using cached auth
}
```

**`load()` on page load:**
1. `GET /api/auth/me`
2. `503` (offline) or network error → `_loadFromCache()`
3. `401` + online → redirect to `/login.html`
4. `401` + offline → `_loadFromCache()`
5. Success → `_saveToCache()` to `localStorage['provista_auth']`

**Feature flags** (always returned from `/api/auth/me`):
```javascript
{ offlineAccess: true, advancedAnalytics: false, barcodeScanning: true }
```

---

## Data Models

### User

| Field | Type | Notes |
|---|---|---|
| `name` | String | required, trimmed |
| `email` | String | required, unique, lowercase |
| `passwordHash` | String | required |
| `householdId` | ObjectId → Household | default null |
| `role` | `'owner'`\|`'admin'`\|`'member'` | default `'member'` |
| `preferences.barcodeAutoAccept` | Boolean | null = inherit household setting |

### Household

| Field | Type | Notes |
|---|---|---|
| `name` | String | required, trimmed |
| `ownerId` | ObjectId → User | required |
| `inviteCode` | String | 6-char alphanumeric, default null |
| `inviteCodeExpiresAt` | Date | 48h from generation, default null |
| `weekStartDay` | Number | 0=Sun, 1=Mon … 6=Sat; default 6 |
| `settings.barcodeAutoAccept` | Boolean | default false |

### Item

| Field | Type | Notes |
|---|---|---|
| `householdId` | ObjectId → Household | required |
| `name` | String | required, trimmed |
| `brand` | String | default `''` |
| `category` | String | required, trimmed |
| `unit` | String | required, trimmed |
| `size` | Number | default null |
| `upc` | String | default null |
| `upcSource` | `'scan'`\|`'backfill'`\|`'manual'` | default null |
| `upcPendingLookup` | Boolean | default false |
| `isOrganic` | Boolean | default false |
| `isSeeded` | Boolean | default false |
| `lastConflict` | Object | `{ resolvedAt, winnerId, winnerName, overwrittenValue }` |

Indexes: `(householdId, name)`, `(householdId, upc)`.

### Store

| Field | Type | Notes |
|---|---|---|
| `householdId` | ObjectId → Household | required |
| `name` | String | required, trimmed |
| `location` | String | trimmed |
| `lastConflict` | Object | see Item |

### PriceEntry

| Field | Type | Notes |
|---|---|---|
| `householdId` | ObjectId → Household | required |
| `itemId` | ObjectId → Item | required |
| `storeId` | ObjectId → Store | required |
| `submittedBy` | ObjectId → User | required |
| `regularPrice` | Number | required — total shelf price for the package |
| `salePrice` | Number | null if not on sale |
| `couponAmount` | Number | null if no coupon |
| `couponCode` | String | e.g. `'Ibotta'`, `'Store app'` |
| `finalPrice` | Number | required — `(salePrice ?? regularPrice) - (couponAmount ?? 0)` |
| `quantity` | Number | required, default 1 |
| `pricePerUnit` | Number | required — `finalPrice / quantity` |
| `date` | Date | default now |
| `source` | `'manual'`\|`'csv'` | default `'manual'` |
| `status` | `'approved'`\|`'pending'` | admin submit → approved; member submit → pending |
| `reviewedBy` | ObjectId → User | default null |
| `reviewedAt` | Date | default null |
| `notes` | String | trimmed |
| `lastConflict` | Object | see Item |

Indexes: `(householdId, itemId, date desc)`, `(householdId, status)`, `(householdId, storeId)`.

**Price calculation:**
```javascript
const base = (salePrice != null && salePrice < regularPrice) ? salePrice : regularPrice;
finalPrice  = base - (couponAmount ?? 0);
pricePerUnit = finalPrice / quantity;
```

### InventoryItem

| Field | Type | Notes |
|---|---|---|
| `householdId` | ObjectId → Household | required |
| `itemId` | ObjectId → Item | required, unique per household |
| `quantity` | Number | required, default 0 |
| `unit` | String | trimmed |
| `lowStockThreshold` | Number | default null |
| `lastUpdatedBy` | ObjectId → User | |
| `lastUpdated` | Date | default now |
| `notes` | String | trimmed |
| `lastConflict` | Object | see Item |

Unique index: `(householdId, itemId)`.

### ShoppingListItem

| Field | Type | Notes |
|---|---|---|
| `householdId` | ObjectId → Household | required |
| `itemId` | ObjectId → Item | required |
| `quantity` | Number | required, default 1 |
| `checked` | Boolean | default false |
| `addedBy` | ObjectId → User | |
| `addedAt` | Date | default now |
| `removedBy` | ObjectId → User | default null |
| `removedAt` | Date | default null |
| `lastConflict` | Object | see Item |

### MealPlan

| Field | Type | Notes |
|---|---|---|
| `householdId` | ObjectId → Household | required |
| `weekStart` | Date | required — unique per household |
| `days` | Array | 7 entries, each `{ date, meals[], specialCollapsed }` |
| `days[].meals[].mealType` | `'breakfast'`\|`'lunch'`\|`'dinner'`\|`'special'` | required |
| `days[].meals[].personName` | String | trimmed, default `''` |
| `days[].meals[].name` | String | trimmed, default `''` |
| `produceNotes` | String | trimmed, default `''` |
| `shoppingNotes` | String | trimmed, default `''` |

Unique index: `(householdId, weekStart)`.

---

## Key Algorithms

### Levenshtein Distance

Used in two places with different thresholds:

```javascript
function _levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => j === 0 ? i : 0));
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}
```

- **CSV import** (`csvImport.js`): threshold ≤ 2, names ≥ 8 chars, length tolerance ±3
- **Admin duplicate detection** (`routes/admin.js`): threshold ≤ 3

### Item Name Normalization (`routes/admin.js`)

```javascript
function _normName(name) {
  return name.toLowerCase().trim()
    .replace(/\s*[-–]\s*(lrg|large|sm|small|med|medium)\s*$/i, '')
    .replace(/s$/, '');   // strip trailing 's' (plural)
}
```

### Cluster Grouping (`routes/admin.js`)

`findDuplicateClusters(householdId)`:
1. Fetch all items, sort by name
2. For each unvisited item, normalize name and collect all items with Levenshtein ≤ 3
3. Pick canonical item (most price entries)
4. Return clusters with ≥ 2 members

### CSV Item Matching (`public/js/csvImport.js`)

`_findItem(csvName, itemMap)`:
1. Exact match (case-insensitive)
2. Singular/plural variant (strip/add trailing `s`)
3. Levenshtein ≤ 2 for names ≥ 8 chars (length tolerance ±3)
4. Returns `{ item, fuzzy: true|false }` or `null`

### Category Normalization — CSV (`public/js/csvImport.js`)

Maps freeform CSV category strings to canonical names:

| Input | Canonical |
|---|---|
| `dry`, `dry goods`, `dried goods`, `pantry dry`, `shelf stable`, `canned`, `canned goods` | `Pantry` |

### Category Normalization — Open Food Facts (`utils/categoryMap.js`)

`mapCategory(categoriesTags)` loops ordered prefix mappings and returns the first match:

| Tags prefix | Category |
|---|---|
| `en:fresh-produce`, `en:fruits`, … | Produce |
| `en:meats`, `en:beef`, … | Meat & Seafood |
| `en:dairies`, `en:dairy`, … | Dairy |
| `en:deli`, `en:prepared-meals`, … | Deli |
| `en:breads`, `en:bakery`, … | Bakery |
| `en:frozen-foods`, … | Frozen |
| `en:beverages`, `en:juices`, … | Beverages |
| `en:snacks`, `en:chips`, … | Snacks |
| `en:condiments`, `en:sauces`, … | Condiments & Sauces |
| `en:cleaning`, `en:household-products`, … | Cleaning & Household |
| _(no match)_ | Pantry |

### Week Start Calculation (`routes/sync.js`)

```javascript
const weekStartDay = household?.weekStartDay ?? 6;  // 0=Sun, 1=Mon, 6=Sat
const todayDay = now.getUTCDay();
const diff = (todayDay - weekStartDay + 7) % 7;
const currentWeekStart = new Date(Date.UTC(
  now.getFullYear(), now.getMonth(), now.getDate() - diff
));
```

### Offline Sub-resource Guard (`public/js/api.js`)

Sub-resource actions (e.g. `/items/123/merge`, `/prices/123/approve`) are never queued offline — only simple CRUD paths are:

```javascript
function _isSimpleCrudPath(method, path) {
  if (method === 'GET') return true;
  const segments = path.split('?')[0].split('/').filter(Boolean);
  return segments.length <= 2;  // /items or /items/123, not /items/123/merge
}
```

### UPC Normalization (`utils/upc.js`)

```javascript
function normalizeUpc(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12) return digits;                              // UPC-A
  if (digits.length === 13 && digits[0] === '0') return digits.slice(1); // EAN-13 → UPC-A
  if (digits.length === 8) return expandUpce(digits);                   // UPC-E → UPC-A
  return null;
}
```

UPC-E expansion: last digit determines pattern (0–2 → manufacturer digits + `0000`; 3 → `00000`; 4 → `00000`; 5–9 → `0000`).

### Barcode Lookup Flow (`routes/barcode.js`)

1. Normalize UPC via `normalizeUpc()`
2. Check local household catalog → return `source: 'local'` if found
3. Query Open Food Facts (`5s` timeout): `https://world.openfoodfacts.org/api/v0/product/{upc}.json`
4. Map fields: name, brand, unit, size, isOrganic, category (via `mapCategory()`)
5. Resolve `autoAccept`: user preference → household setting → `false`
6. Return `{ found, source, confidence: 'full'|'partial', autoAccept, missingFields[] }`

---

## Service Worker Caching Strategy (`public/sw.js`)

Cache names: `provista-shell-v4` (static assets), `provista-api-v4` (API responses).

| Request type | Strategy |
|---|---|
| `/api/*` | Network-first; cache GET on success; return `503 { offline: true }` if no cache |
| `/js/*`, `/css/*` | Network-first; cache fallback when offline |
| `/icons/*`, `/images/*` | Cache-first; background refresh |
| SPA navigation | Network-first; serve cached `index.html` if offline |

**Install:** Pre-caches all shell assets (HTML, CSS, JS, icons, manifest); calls `skipWaiting()`.

**Activate:** Deletes stale cache versions; calls `clients.claim()`.

---

## Offline / IndexedDB Schema & Sync Queue (`public/js/offline.js`)

Database: `provista-offline` v1.  Stale threshold: **15 minutes**.

### Object Stores

| Store | Key | Contents |
|---|---|---|
| `items` | `_id` | Household items |
| `stores` | `_id` | Household stores |
| `priceEntries` | `_id` | Price entries |
| `inventory` | `_id` | Inventory items |
| `shoppingList` | `_id` | Shopping list items |
| `mealPlan` | `_id` | Meal plans |
| `spendCache` | `month` (YYYY-MM) | Pre-calculated monthly spend totals |
| `syncQueue` | `id` (UUID) | Pending offline operations |
| `metadata` | `collection` | Last-synced timestamps per collection |

### Sync Queue Item

```javascript
{
  id:          UUID,
  operation:   'CREATE' | 'UPDATE' | 'DELETE',
  collection:  store name,
  payload:     request body,
  path:        API path,
  method:      'POST' | 'PUT' | 'DELETE',
  createdAt:   ISO string,
  attempts:    number,
  status:      'pending' | 'failed'
}
```

### Sync Flow

1. **Offline write** → enqueue to `syncQueue` + show toast
2. **Back online** → process queue in order:
   - Success → delete from queue; update local DB with response
   - Failure → increment `attempts`; mark `'failed'` after 3 retries
3. Show synced count or failure badge; user can retry or discard failed ops

### Offline Query Filtering

| Path pattern | Filter |
|---|---|
| `/prices/history/:itemId` | One item, sorted by date desc |
| `/prices/compare/:itemId` | Latest per store, sorted by `pricePerUnit` |
| `/prices/last-purchased/:itemId` | Most recent per store |
| `/spend?month=YYYY-MM` | Cached spend object for month |
| `/spend/summary` | All cached months |
| `/inventory/low-stock` | `quantity <= lowStockThreshold` |
| `/prices/pending` | `status === 'pending'` |
| `/items?search=...` | Name substring, case-insensitive |

---

## Dependencies

### Runtime

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.19.2 | Web framework |
| `mongoose` | ^8.4.1 | MongoDB ODM |
| `bcrypt` | ^5.1.1 | Password hashing (12-round cost) |
| `jsonwebtoken` | ^9.0.2 | JWT creation / verification |
| `cookie-parser` | ^1.4.6 | Parse httpOnly cookies |
| `qrcode` | ^1.5.4 | QR codes for household invites |
| `cors` | ^2.8.5 | CORS headers |
| `dotenv` | ^16.4.5 | Load `.env` files |

### Dev

| Package | Version | Purpose |
|---|---|---|
| `jest` | ^30.3.0 | Unit / API tests |
| `supertest` | ^7.2.2 | HTTP assertions in Jest |
| `mongodb-memory-server` | ^11.0.1 | In-memory MongoDB for tests |
| `@playwright/test` | ^1.59.1 | End-to-end tests |
| `nodemon` | ^3.1.4 | Dev auto-restart |

Node.js requirement: `>=18.0.0`.
