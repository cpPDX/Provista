# Authenticated frontend retirement - PRO-56

PRO-56 completes Provista's strangler migration by removing the authenticated vanilla-JS application after React parity was proven. This document records the final ownership boundary and the regression gates that make the deletion safe.

## Final ownership boundary

The authenticated product is React + TypeScript. `server.js` serves the generated Vite shell for `/app` and all authenticated React routes. There is no authenticated HTML fallback and no `window.*` feature-global compatibility layer.

The public/non-React surface intentionally retained is small:

| Asset | Ownership |
| --- | --- |
| `public/landing.html`, `public/js/landing.js`, `public/css/landing.css` | Public marketing and entry experience |
| `public/login.html`, `public/css/auth.css`, `public/css/style.css` | Signed-out authentication/reset/join experience |
| `public/sw.js`, `public/manifest.json`, icons/brand assets | PWA shell, installability, and static assets |
| `public/react-preview/*` | Generated Vite production client output |

## Removed authenticated legacy surface

The final retirement deletes:

- `public/index.html`, the old authenticated application shell
- legacy authenticated bootstrap, routing, API, UI, modal, autocomplete, Home, Plan, List, Pantry, Prices, Spending, More, Household, catalog, Import, onboarding, scanner, and install-prompt JavaScript
- the legacy IndexedDB helper and legacy offline queue implementation
- the dormant receipt OCR prototype; future receipt work remains owned by PRO-37/PRO-39
- `reactHomeBridge.js` and every remaining React-to-legacy bridge
- authenticated-legacy-only `parentExperience.css` and `rapidShoppingCapture.css`
- browser specs whose only purpose was exercising `/legacy-app` and the deleted DOM

React List owns its own IndexedDB queue/recovery implementation in `client/src/list/storage.ts`; deleting `public/js/vendor/idb.min.js` and `public/js/offline.js` does not remove React offline support.

## Compatibility redirects

Migration-era bookmarks no longer render old HTML. `server.js` permanently redirects known destinations into their React equivalents:

| Old destination | React destination |
| --- | --- |
| `/app?tab=home` | `/app` |
| `/app?tab=list` | `/app/list` |
| `/app?tab=inventory` | `/app/pantry` |
| `/app?tab=meal-plan` | `/app/plan` |
| `/app?tab=prices` | `/app/more/insights/prices` |
| `/app?tab=spend` | `/app/more/insights/spending` |
| `/app?tab=more&section=account` | `/app/more/account` |
| `/app?tab=more&section=household` | `/app/more/household` |
| `/app?tab=more&section=stores` | `/app/more/stores` |
| `/app?tab=more&section=items` | `/app/more/products` |
| `/app?tab=more&section=insights` | `/app/more/insights` |
| `/app?tab=more&section=about` | `/app/more/help` |
| `/app?tab=more&action=csv-import` | `/app/more/import` |
| `/legacy-app` | `/app` |

Unknown migration-era authenticated destinations converge on `/app` rather than reviving the compatibility renderer.

## Offline and PWA contract

`public/sw.js` now uses the React-era `provista-shell-v15` cache and no longer precaches legacy authenticated files.

The worker:

- precaches only public/auth assets that are still intentionally retained
- dynamically caches the current `/app` shell and its hashed Vite assets
- deletes prior shell/API caches during activation
- uses `/app` as the authenticated navigation fallback
- keeps JS/CSS/API requests network-first so deploys and reconnects take effect promptly

React PWA guidance owns the existing `provista_visits`, `installPromptDismissed`, and `installPromptRemindAt` keys, preserving prior user choices across migration. It remains iOS Safari-specific, suppresses itself in standalone mode, and promises only the supported offline List behavior.

## Replacement coverage

Legacy-only Playwright specs were removed instead of remaining as zombie tests. Their current owners are:

| Retired coverage area | Current regression owner |
| --- | --- |
| Shell/navigation/user menu | `home.spec.js`, `reactShell.spec.js`, `pro56LegacyDeletion.spec.js` |
| Help, Account, Household, Stores, Insights, Import | `pro56LegacyRetirement.spec.js` |
| Price History and recovery states | `pro56PriceParity.spec.js` |
| List, checkout, rapid capture, destructive List actions | `reactShoppingList.spec.js`, PRO-60/63/64/65/75/82 specs |
| Pantry and low-stock behavior | `reactPantry.spec.js`, PRO-61/64 specs |
| Plan and meal workflows | `reactPlan.spec.js`, PRO-64/72/76 specs |
| Barcode/scanner behavior | `pro21Barcode.spec.js` |
| Offline queue failure/retry/discard/reconnect | `pro56OfflineSyncRecovery.spec.js` |
| PWA install guidance | `pro56PwaInstallGuidance.spec.js` |
| Mobile/keyboard shell accessibility | React-owned `accessibility.spec.js`, `pro72MobileReflow.spec.js`, `reactShell.spec.js` |

`pro56LegacyDeletion.spec.js` is the final retirement guard: old bookmarks must land in React, retired assets must return 404, and the service worker must not cache the deleted shell.

## Closure gates

PRO-56 can close when the exact final head proves all of the following:

- React client build and API suite are green.
- React Home, Plan, List, Pantry, More, barcode, cross-workflow state, and onboarding browser suites are green.
- `pro56LegacyRetirement`, `pro56PriceParity`, `pro56OfflineSyncRecovery`, `pro56PwaInstallGuidance`, and `pro56LegacyDeletion` are green.
- WebKit runs the React accessibility and PWA install-guidance coverage.
- Staging deploys the exact approved GitHub SHA through the GitHub-managed deployment workflow.
- The deployed staging revision matches that GitHub SHA before PRO-56 is marked Done.
