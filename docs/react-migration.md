# React migration foundation

Provista is migrating its authenticated application incrementally from imperative vanilla JavaScript to React + TypeScript. The migration follows the strangler pattern: existing production workflows remain authoritative until an individual feature has equivalent React coverage and regression tests.

## Architecture boundary

- `server.js`, Express routes, Mongoose models, and MongoDB remain unchanged by the frontend migration unless a feature requires an independently justified API change.
- `public/` remains the current production frontend during the migration.
- `client/` contains the new React + TypeScript application.
- Vite builds the migration client into `public/react-preview/`. That directory is generated and intentionally not committed.
- The public marketing/landing experience is not being converted to React as part of this effort.

## Toolchain

- React 19
- TypeScript
- Vite
- TanStack Query
- React Router (available for the application-shell migration)

## Local development

Install dependencies from the repository root:

```bash
npm install
```

The root install runs the client install as a `postinstall` step while the migration uses separate package manifests.

Run the existing Express application:

```bash
npm run dev
```

In another terminal, run the React/Vite development server:

```bash
npm run client:dev
```

Vite serves the migration preview on port 5173 and proxies `/api` requests to the Express server on port 3000.

## Build and validation

```bash
npm run client:typecheck
npm run client:build
```

The normal root `build` script currently delegates to the React client build. CI performs the client build in addition to the existing API and browser test suites.

For this foundation slice, the generated preview is intentionally isolated from `/app`; no current user workflow is routed to React yet.

## Migration order

1. Shared authenticated application shell: session/auth context, navigation, modal/toast, dirty-form protection.
2. Home as the first production React feature and deployment/PWA validation point.
3. Shopping List and checkout.
4. Pantry and shared product interactions.
5. Plan and action-based onboarding.
6. Legacy authenticated-JS removal plus offline/PWA hardening.

## Guardrails

- Keep each migration PR deployable and reversible.
- Preserve current UX before making unrelated design changes.
- Add Playwright coverage before deleting a legacy implementation.
- Preserve cached authentication, documented offline behavior, service-worker updates, and PWA installability.
- Do not introduce Redux unless actual state complexity proves React Context plus TanStack Query insufficient.
