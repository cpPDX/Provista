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
| `public/js/vendor/idb.min.js` | 4 | Legacy offline storage dependency and service-worker cache | Keep until React/offline storage no longer depends on legacy IndexedDB behavior |
| `public/js/auth.js` | 2 | Loaded by legacy authenticated `index.html`; provides `window.appAuth` | Delete with compatibility renderer after secondary More tools move to React |
| `public/js/offline.js` | 4 | Legacy offline queue/cache behavior | Reconcile against React/PWA offline contracts before deletion |
| `public/js/api.js` | 2 | Legacy authenticated API wrapper | Delete after all compatibility-renderer features are retired |
| `public/js/ui.js` | 2 | Legacy modal/toast/general DOM helpers | Delete after all legacy feature callers are gone |
| `public/js/confirmAction.js` | 2 | Legacy confirmation helper | Delete after legacy destructive-action callers are gone |
| `public/js/autocomplete.js` | 2 | Legacy item/store autocomplete helper | Delete after remaining legacy forms migrate |
| `public/js/prices.js` | 3 | Price History is React-owned under More → Insights; legacy compatibility renderer still loads this file | Delete after React Insights parity is green and legacy Prices entry is unreachable |
| `public/js/spend.js` | 3 | Spending is React-owned under More → Insights; legacy compatibility renderer still loads this file | Delete after React Insights parity is green and legacy Spending entry is unreachable |
| `public/js/shoppingList.js` | 3 | List/Shop is React-owned; legacy compatibility renderer still loads this file | Delete only after no authenticated route can enter legacy List and overlapping legacy tests are replaced |
| `public/js/rapidShoppingCapture.js` | 3 | Dynamically loaded by legacy `app.js`; React List owns rapid capture | Delete with legacy List/app orchestration after parity proof |
| `public/js/csvImport.js` | 2 | More → Import prices legacy entry | PRO-56: migrate/import ownership before deletion |
| `public/js/csvImportUnified.js` | 2 | Dynamically loaded by `householdPeople.js` for legacy unified import writes | Delete after Import/Household legacy callers retire |
| `public/js/more.js` | 2 | Legacy compatibility renderer still contains old Account, Household, Stores, Insights and other overlapping renderers | React owns those user-facing surfaces; retain until Import and remaining compatibility callers are separated |
| `public/js/moreInit.js` | 2 | Legacy More routing; dynamically loads catalog and old More behavior | Help/App Tour, Account/Household/Stores, and Insights are React-owned; delete only after Import and remaining More compatibility routes retire |
| `public/js/householdPeople.js` | 2 | Legacy compatibility Household enhancement plus dynamic grocery/import overrides | Household is React-owned in the second reopened slice; retain until remaining grocery/import compatibility callers are removed |
| `public/js/groceryEntry.js` | 2 | Dynamically injected by `householdPeople.js` | Delete/extract after remaining legacy grocery-entry callers are gone |
| `public/js/pantry.js` | 3 | Pantry is React-owned; legacy compatibility renderer still loads this file | Delete after no authenticated route can enter legacy Pantry and parity tests cover the replacement |
| `public/js/mealPlan.js` | 3 | Plan is React-owned; legacy compatibility renderer still loads this file | Delete after no authenticated route can enter legacy Plan and parity tests cover the replacement |
| `public/js/home.js` | 3 | Home is React-owned; legacy compatibility renderer still loads this file | Delete with legacy shell once compatibility navigation is gone |
| `public/js/onboarding.js` | 2 | Legacy setup/App Tour implementation | Action-based onboarding and App Tour are React-owned; legacy copy can retire with compatibility shell after remaining setup dependencies are checked |
| `public/js/catalog.js` | 3 | Manage Products is React-owned; legacy `moreInit.js` can still dynamically load catalog | Delete after legacy More catalog entry is unreachable and PRO-83 parity remains green |
| `public/js/storeSections.js` | 2 | Legacy List store-section grouping and section picker, dynamically loaded by `app.js` | Verify React List store-section parity and remove the legacy List caller before deletion; this is not the Stores settings renderer |
| `public/js/scanner.js` | 2 | Legacy compatibility scanner UI | Barcode migration is owned by PRO-21; delete after React List/Pantry barcode paths are complete |
| `public/js/scan.js` | 3 | Not loaded by `index.html`; currently retained in service-worker cache and architecture docs | Verify no runtime caller, then remove from cache/docs and delete in a dedicated cleanup slice |
| `public/js/reactHomeBridge.js` | 2 | Injected only by `serveLegacyApp()` in `server.js` | Delete with the compatibility renderer |
| `public/js/install-prompt.js` | 4 | PWA install prompt behavior, loaded by legacy shell and cached by service worker | Preserve or port independently of legacy renderer |
| `public/js/app.js` | 2 | Legacy authenticated bootstrap/navigation; dynamically loads rapid capture and store sections | Last legacy renderer file to retire after Import/scanner paths are React-owned |

## Current authenticated legacy entry points

`server.js` still intentionally exposes the compatibility renderer through:

- `/app?tab=...`
- `/app?legacy=1`
- `/legacy-app`
- `serveReactApp()` fallback when the built React index is absent outside production/CI

The React shell must not create new links to those entry points. Import prices is now the only More card that intentionally enters the compatibility renderer; scanner ownership remains separately tied to PRO-21.

## First reopened retirement slice

This slice moved these user-visible paths fully into React:

- More → Help & About
- More → App Tour
- Help → Restart App Tour
- React unavailable state no longer offers `Open current app` as a legacy escape hatch
- `/app/more/help` is served directly by the React shell so a hard reload cannot fall through to legacy HTML

The legacy Help/Tour implementation remains temporarily present as parity evidence for the compatibility renderer. It is deleted only after the new Playwright path is green and the rest of `moreInit.js` / `onboarding.js` dependencies are separated.

## Second reopened retirement slice

This slice moved the next high-friction More settings paths into React without changing their server-side contracts:

- More → My Account, including profile/preferred name, password changes, account deletion, and the existing barcode preference
- More → Household, including the unified roster, planning-only people, roles/access, invites, household/shopping defaults, and owner deletion
- More → Stores, including household store create/edit/delete behavior
- `/app/more/account`, `/app/more/household`, and `/app/more/stores` are direct React shell routes so hard reload cannot fall through to legacy HTML
- React-owned More cards use client-side routing instead of forcing a document reload

This does **not** retire the barcode scanner itself. Scanner migration remains owned by PRO-21. It also does not delete `more.js` or `householdPeople.js` yet because the compatibility renderer and Import-related overrides still call them.

## Third reopened retirement slice

This slice moves the complete More → Insights flow into React while retaining the existing server-side contracts:

- More → Insights
- Insights → Price History, including household search/filter recovery states, price recording, and admin pending-price review
- Insights → Spending, including month navigation, category/store breakdown, six-month context, and drill-down into filtered Price History
- `/app/more/insights`, `/app/more/insights/prices`, and `/app/more/insights/spending` are direct React shell routes so hard reload cannot fall through to legacy HTML

`public/js/prices.js` and `public/js/spend.js` remain temporarily available only through the legacy compatibility renderer until the new PRO-56 parity coverage is green and the compatibility entry points are removed.

## Planned deletion order

1. Finish remaining React-to-legacy feature ownership: Import, plus barcode/scanner paths owned by PRO-21.
2. Remove `/app?tab=...` creation from React and add a regression guard against authenticated legacy URLs.
3. Delete legacy feature renderers whose React parity tests are green: Home, Plan, List, Pantry, catalog, Help/Tour, Account, Household, Stores, Price History, and Spending.
4. Retire compatibility-only shared helpers and `app.js` after no feature callers remain.
5. Remove `/legacy-app`, `serveLegacyApp()`, `public/index.html`, legacy CSS/script cache entries, and `reactHomeBridge.js`.
6. Bump/trim service-worker caches and re-run offline/PWA navigation coverage before closing PRO-56.
