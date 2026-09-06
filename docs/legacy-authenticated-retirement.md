# Legacy authenticated frontend retirement map

PRO-56 retires the authenticated vanilla-JS renderer only after the corresponding React behavior is parity-proven. This document is the dependency map used to decide deletion order. It is intentionally conservative: a file stays until its remaining caller and PWA impact are understood.

## Classification

1. **Public/non-React retained** - intentionally outside the authenticated React app.
2. **Migration dependency** - still reachable from the legacy compatibility renderer or a remaining React-to-legacy path; PRO-56 owns retirement unless another issue is named.
3. **React replacement complete, deletion candidate** - user-facing replacement exists, but deletion still waits for dependency and Playwright proof.
4. **Shared behavior to extract/retain** - implementation is not a renderer and may need a React/shared replacement before the legacy file can disappear.

## Entry points and helpers

| File | Class | Current dependency / ownership | Retirement gate |
| --- | --- | --- | --- |
| `public/js/landing.js` | 1 | Public marketing/entry experience (`landing.html`) | Retain unless public-site scope changes |
| `public/js/vendor/idb.min.js` | 4 | Legacy offline storage dependency and service-worker cache | Keep until final service-worker/offline cleanup proves React no longer depends on this legacy asset |
| `public/js/auth.js` | 2 | Loaded by legacy authenticated `index.html`; provides `window.appAuth` | Delete with compatibility renderer after all authenticated legacy entries are gone |
| `public/js/offline.js` | 3 | React List now owns supported offline queueing plus persistent failed-sync Review / Retry / safe Discard recovery | Delete legacy queue/recovery UI after final service-worker/offline regression confirms no remaining runtime caller |
| `public/js/api.js` | 2 | Legacy authenticated API wrapper | Delete after all compatibility-renderer features are retired |
| `public/js/ui.js` | 2 | Legacy modal/toast/general DOM helpers | Delete after all legacy feature callers are gone |
| `public/js/confirmAction.js` | 2 | Legacy confirmation helper | Delete after legacy destructive-action callers are gone |
| `public/js/autocomplete.js` | 2 | Legacy item/store autocomplete helper | Delete after remaining legacy forms migrate |
| `public/js/prices.js` | 3 | Price History is React-owned under More → Insights, including best-value guidance, full manual capture, pending correction/approval, barcode initiation, and approved-price deletion | Delete after compatibility Prices entry is unreachable and current PRO-56 price parity tests remain green |
| `public/js/spend.js` | 3 | Spending is React-owned under More → Insights | Delete after legacy Spending entry is unreachable |
| `public/js/shoppingList.js` | 3 | List/Shop is React-owned; failed offline sync recovery is also React-owned | Delete only after no authenticated route can enter legacy List and overlapping legacy tests are replaced |
| `public/js/rapidShoppingCapture.js` | 3 | Dynamically loaded by legacy `app.js`; React List owns rapid capture | Delete with legacy List/app orchestration after parity proof |
| `public/js/csvImport.js` | 3 | Import prices is React-owned; legacy compatibility renderer still contains the old parser/review UI | Delete after legacy Import entry is unreachable |
| `public/js/csvImportUnified.js` | 3 | React Import writes directly through `/api/grocery/log`; this legacy override is still dynamically loaded by `householdPeople.js` | Delete after legacy Import/Household compatibility callers are unreachable |
| `public/js/more.js` | 2 | Legacy compatibility renderer still contains overlapping More renderers | All user-facing More cards are React-owned; retain only until compatibility callers are removed |
| `public/js/moreInit.js` | 2 | Legacy More routing; dynamically loads catalog and old More behavior | All user-facing More destinations are React-owned; delete after legacy More compatibility entry is unreachable |
| `public/js/householdPeople.js` | 2 | Legacy compatibility Household enhancement plus dynamic grocery/import overrides | Household and Import are React-owned; retain until remaining compatibility callers are removed |
| `public/js/groceryEntry.js` | 2 | Dynamically injected by `householdPeople.js` | Delete/extract after remaining legacy grocery-entry callers are gone |
| `public/js/pantry.js` | 3 | Pantry is React-owned; legacy compatibility renderer still loads this file | Delete after no authenticated route can enter legacy Pantry and parity tests cover the replacement |
| `public/js/mealPlan.js` | 3 | Plan is React-owned; legacy compatibility renderer still loads this file | Delete after no authenticated route can enter legacy Plan and parity tests cover the replacement |
| `public/js/home.js` | 3 | Home is React-owned; legacy compatibility renderer still loads this file | Delete with legacy shell once compatibility navigation is gone |
| `public/js/onboarding.js` | 3 | Server-backed action onboarding and App Tour are React-owned | Delete with compatibility shell after legacy setup entry is unreachable |
| `public/js/catalog.js` | 3 | Manage Products is React-owned; legacy `moreInit.js` can still dynamically load catalog | Delete after legacy More catalog entry is unreachable and PRO-83 parity remains green |
| `public/js/storeSections.js` | 3 | React List owns store-section grouping and custom section entry | Delete with legacy List/app orchestration after the legacy caller is removed |
| `public/js/scanner.js` | 3 | React barcode resolution is complete for List, Pantry, Products, and Price History | Delete after compatibility scanner entry is unreachable; PRO-21 parity remains green |
| `public/js/scan.js` | 3 | Dormant receipt OCR prototype; not loaded by authenticated HTML | Remove from service-worker cache/docs and delete; future receipt work is owned separately by PRO-37/PRO-39 |
| `public/js/reactHomeBridge.js` | 2 | Injected only by `serveLegacyApp()` in `server.js` | Delete with the compatibility renderer |
| `public/js/install-prompt.js` | 3 | React shell now owns iOS Safari Home Screen guidance using the same visit/dismiss/remind keys | Delete after the React PWA guidance regression is green |
| `public/js/app.js` | 2 | Legacy authenticated bootstrap/navigation; dynamically loads old feature helpers | Last legacy renderer file to retire after feature renderers and compatibility entry points are removed |

## Current authenticated legacy entry points

`server.js` still intentionally exposes the compatibility renderer through:

- `/app?tab=...`
- `/app?legacy=1`
- `/legacy-app`
- `serveReactApp()` fallback when the built React index is absent outside production/CI

The React shell no longer creates those URLs. Before final removal, old `/app?tab=...` bookmarks should be redirected to their React equivalents where practical instead of becoming abrupt dead ends.

## Completed reopened retirement slices

### Help and App Tour

- More → Help & About
- More → App Tour
- Help → Restart App Tour
- React unavailable state no longer offers a legacy escape hatch
- `/app/more/help` hard reload stays in React

### More settings

- My Account, including profile, password, account deletion, and barcode preference
- Household, including roster, planning people, roles/access, invites, settings, and household deletion
- Stores create/edit/delete
- direct React hard-refresh routes for account, household, and stores

### Insights and Prices

- More → Insights
- Price History search/filter/recovery, manual price recording, best-recent-value guidance and price-per-unit sorting
- admin pending Approve / Reject / Edit & Approve
- admin deletion of approved price observations
- new-product size/organic metadata, notes, and React barcode initiation from Prices
- Spending month navigation, category/store breakdowns, six-month context, and drill-down
- direct React routes for Insights, Price History, and Spending

### Import prices

- CSV template and client-side parsing
- review errors/warnings and explicit fuzzy-match resolution
- missing item/store creation through transactional `/api/grocery/log`
- same-item/store/day replacement using server semantics
- direct React route `/app/more/import`

### Failed offline List sync recovery

- failed supported List writes remain visible in React after repeated sync failure
- Retry makes an explicit new attempt and remains visible if the retry still fails
- Discard first refreshes the canonical server List, then removes the failed write and reconciles the device cache
- failed offline CREATE discard also removes dependent queued writes to its temporary local ID
- successful offline CREATE remaps queued UPDATE/DELETE paths from the temporary `local-*` ID to the real server ID
- focused Playwright coverage proves retry, discard, reconciliation, and reconnect behavior

### React PWA install guidance

This active slice replaces the final user-facing behavior in `public/js/install-prompt.js` without changing service-worker registration:

- iOS Safari-only Home Screen guidance after the second authenticated visit
- standalone-installed suppression
- the existing `provista_visits`, `installPromptDismissed`, and `installPromptRemindAt` keys are preserved so existing user choices survive the migration
- Remind me later remains seven days
- permanent dismissal remains available
- Android/Chromium native install handling is left to the browser instead of introducing a custom prompt
- copy only promises supported offline List behavior rather than overclaiming that every Insights surface is offline-capable

## Planned deletion order

1. Finish and merge React PWA install guidance, making `install-prompt.js` parity-proven.
2. Delete parity-proven legacy feature renderers in reviewable slices: Home, Plan, List, Pantry, catalog, scanner, Help/Tour, Account, Household, Stores, Prices, Spending, Import, dormant receipt OCR, and their feature-only helpers.
3. Retire compatibility-only shared helpers and `app.js` after no feature callers remain.
4. Replace old `/app?tab=...` compatibility bookmarks with React redirects where appropriate, then remove `/legacy-app`, `serveLegacyApp()`, `public/index.html`, and `reactHomeBridge.js`.
5. Remove obsolete legacy CSS/script entries from the service-worker cache and bump/trim caches for the final React asset pipeline.
6. Re-run cached-auth, offline reads, supported offline mutations/recovery, reconnect, installability, and update/navigation coverage before closing PRO-56.
