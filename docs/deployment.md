# Deployment Operations

Provista uses isolated Railway `Staging` and `production` environments. GitHub
`staging` is the integration branch; GitHub `main` is the production release
branch. Production promotion is intentionally separate from the staging queue
described here.

## Railway staging deployment queue

The current Railway plan does not accept deployments between 8:00 AM and
8:00 PM Pacific and does not queue a skipped commit for later. The
`Railway Staging Queue` GitHub Actions workflow preserves that deployment intent.

The workflow uses `America/Los_Angeles`, rather than a fixed UTC offset, so the
boundary follows daylight-saving changes:

- Blackout: 8:00 AM through 7:59 PM Pacific.
- Allowed: 8:00 PM through 7:59 AM Pacific.
- Reconciliation: 7 and 37 minutes past each half hour in the allowed window.

### One-time setup

1. In the Railway Provista project, create a **project token scoped to the
   Staging environment**. Do not use an account-wide token.
2. In GitHub, open **Settings → Secrets and variables → Actions** and create the
   repository secret `RAILWAY_STAGING_TOKEN` with that token.
3. Ensure `.github/workflows/deploy-staging.yml` exists on `main`, the repository's
   default branch. GitHub runs scheduled and `workflow_run` workflows from the
   default branch only.

The workflow already identifies the current Provista staging project,
environment, service, and health endpoint. Update those non-secret values in the
workflow if the Railway service is recreated or its domain changes.

Railway's native GitHub autodeploy can remain enabled with **Wait for CI**. It
handles deployments normally when Railway accepts them. The GitHub workflow is
a reconciler: before uploading anything, it checks both GitHub's deployment
record and Railway's deployment history for the exact staging SHA. It adopts an
active or successful native deployment instead of creating a duplicate.

### Normal staging path

1. Merge a reviewed change into `staging`.
2. `App CI` validates the resulting staging merge commit.
3. A successful push run records that exact SHA as queued in GitHub.
4. During the blackout, no Railway command runs.
5. During the allowed window, a scheduled or manually dispatched run resolves
   the current `staging` head and confirms that exact SHA has successful push CI.
6. If Railway is already processing it, GitHub leaves it pending. If Railway
   already completed it, GitHub verifies readiness and adopts it. Otherwise,
   GitHub checks out and uploads that exact SHA with the pinned Railway CLI.
   Deployment-control scripts always come from trusted `main`; staging source is
   checked out separately and is never executed with the Railway token.
7. `/api/health/ready` must report a connected database before GitHub marks the
   deployment successful.

One concurrency group allows only one reconciler to run. GitHub keeps the newest
pending run, and queued deployment records for older staging SHAs are marked
inactive as superseded. An allowed-window failure remains eligible for the next
scheduled retry. A SHA already recorded as successful is not deployed again.

### Status and recovery

Open **Actions → Railway Staging Queue** or the repository's Deployments view.
The workflow records queued, pending, in-progress, successful, failed, and
superseded states with the staging SHA.

- Missing token: add or rotate `RAILWAY_STAGING_TOKEN`; the next allowed-window
  run retries automatically.
- Transient Railway failure: wait for the next scheduled run, or use **Run
  workflow** during the allowed window.
- Failed readiness check: inspect Railway deploy logs and the staging database;
  the SHA remains retryable after the service is healthy.
- Newer staging commit: do not retry the older SHA. The workflow automatically
  marks it superseded and reconciles the current green head.
- Emergency production work: use the separate production promotion process.
  This workflow cannot deploy to production.

Never put a Railway token in workflow YAML, logs, issue comments, or repository
variables. Rotate the project token in Railway and replace the GitHub secret if
it is ever exposed.
