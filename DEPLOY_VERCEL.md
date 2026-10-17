# Deploying to Vercel

This repo now has a Vercel-specific serverless path (`api/index.ts` + `vercel.json`)
alongside the existing Docker/Cloud Run path (`Dockerfile` + `docker-entrypoint.sh`).
The code prep is done; the steps below are the manual dashboard/config work that
only a human with access to the Vercel project, database provider, and secret
values can do — this doc does not and cannot do them for you.

> **Heads up on dependencies:** this app was already caught shipping one
> ESM-only dependency that built and ran fine under `ts-node` (dev mode) but
> crashed under `node` on Vercel's Node runtime with `ERR_REQUIRE_ESM` — it's
> since been removed. If a future dependency add ever reproduces that error in
> production, the fix is to pin to a CommonJS-compatible version or avoid the
> package entirely — not to chase Node version flags. Before adding any new
> dependency, confirm its installed `package.json` does **not** contain
> `"type": "module"`.

## 1. Database (Neon or Vercel Postgres)

Connect a Vercel Postgres or Neon integration to the project (Vercel dashboard
→ Storage → Create/Connect Database). Both provide two connection strings —
usually labeled **"pooled connection"** and **"direct connection"**:

- Copy the **pooled** connection string into the project's `DATABASE_URL` env var.
  This is what the running app queries through at runtime (PgBouncer-style —
  safe for many concurrent serverless function invocations each opening a
  connection).
- Copy the **direct (unpooled)** connection string into `DIRECT_URL`. This is
  used only by `prisma migrate deploy`, which the `vercel-build` script runs
  automatically on every deploy.

Set both for every environment you deploy (Production, and Preview if you
want preview deployments to run against a real database).

## 2. Required secrets

Set these in the Vercel project's environment variables (Production at minimum):

- `JWT_SECRET` — long random string
- `PAYSTACK_SECRET_KEY`
- `FLUTTERWAVE_SECRET_KEY`
- `FLUTTERWAVE_SECRET_HASH` — must match what's configured in the Flutterwave
  dashboard under Settings → Webhooks
- `CORS_ORIGINS` — comma-separated allowlist of your frontend origin(s), e.g.
  `https://your-frontend.example.com,https://admin.example.com`
- `NODE_ENV=production` — Vercel sets this by default for Production
  deployments, but confirm it's actually present, since `DIRECT_URL`,
  `JWT_SECRET`, `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`, and
  `FLUTTERWAVE_SECRET_HASH` are all validated as **required** once
  `NODE_ENV=production` (see `src/config/env.validation.ts`) — the app will
  refuse to boot without them.

## 3. Optional: email

Two mutually exclusive backends, both optional — exactly as they are locally.
`NodemailerEmailProvider` checks `EMAIL_USER`/`EMAIL_PASS` (Gmail) first, then
falls back to `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`
(generic SMTP). If neither is set, `EmailService` falls back to
console-logging the would-be email instead of sending it, so the app boots
and every flow that triggers an email keeps working with no mail credentials
configured at all.

For Gmail specifically: `EMAIL_PASS` must be a 16-character **App Password**
(Google Account → Security → App Passwords) — Gmail rejects the account's
normal login password for SMTP auth.

## 4. File storage (Cloudflare R2)

The local-disk `/uploads` path (`LocalStorageService`) doesn't work on
Vercel — its filesystem is ephemeral and not shared across function
instances. Production listing photos use **Cloudflare R2** via
`R2StorageService` (`src/common/storage/r2-storage.service.ts`). Clients
ask `POST /api/v1/storage/uploads` for a short-lived presign, PUT the file
themselves (never through the Nest body), then `complete`. That is the
supported cloud upload path and it stays under Vercel's ~4.5MB request
limit.

To enable R2 on Vercel (or any host):

1. Create an R2 bucket and an API token with **Object Read & Write**.
2. Enable public access or a custom domain; that origin is `R2_PUBLIC_BASE_URL`.
3. Set bucket CORS so browsers can `PUT` and `HEAD` from the web origin
   (`*` or the app origin for mobile).
4. Add a lifecycle rule: abort incomplete multipart uploads after 1 day.
5. Set `STORAGE_PROVIDER=r2` plus `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL`. Missing
   R2 keys fail Joi at boot.

Leave `STORAGE_PROVIDER=local` on Docker/Cloud Run local-dev. `vercel-blob`
remains a fallback (`BLOB_READ_WRITE_TOKEN` + `STORAGE_PROVIDER=vercel-blob`);
those uploads still go through `PUT /api/v1/storage/local/:key`.

`POST /listings/:id/images` still works via `storage.upload()` for
server-side attaches, but hosts should use the presign flow.

## 5. Scheduled jobs (Vercel Cron)

The background sweeps that run via `setInterval` on the Docker/Cloud Run
deploy (`BookingsExpiryJob`, hourly; `RefundsProcessorJob`, every 5 minutes;
`StorageSweepJob`, every 15 minutes) **do not run at all on
Vercel** — serverless has no long-lived process for `setInterval` to fire on.
Their logic is also exposed via secured HTTP endpoints for Vercel Cron
to call instead:

- `POST /api/v1/internal/cron/booking-expiry`
- `POST /api/v1/internal/cron/refund-processor`
- `POST /api/v1/internal/cron/storage-sweep`

Both are guarded by `CronSecretGuard` (`src/common/guards/cron-secret.guard.ts`),
which checks the request's `Authorization` header equals
`Bearer <CRON_SECRET>` and rejects (401) otherwise — including when
`CRON_SECRET` isn't set at all. There is no `JwtAuthGuard`/`RolesGuard` on
these routes; Vercel Cron carries no user session.

`vercel.json`'s `"crons"` array points at both paths, once per day each,
staggered 15 minutes apart — this is deliberately **Hobby-plan-compatible**
(see the limitation below for why neither job runs at the Docker/Cloud Run
cadence on Vercel):

```json
"crons": [
  { "path": "/api/v1/internal/cron/booking-expiry", "schedule": "0 3 * * *" },
  { "path": "/api/v1/internal/cron/refund-processor", "schedule": "15 3 * * *" },
  { "path": "/api/v1/internal/cron/storage-sweep", "schedule": "30 3 * * *" }
]
```

**Final step:** set `CRON_SECRET` in the Vercel project's env vars (any long
random value) — Vercel automatically sends it as a `Bearer` token to your
cron endpoints, no extra dashboard toggle needed beyond the `"crons"` array
already in `vercel.json`. `CRON_SECRET` is required whenever
`NODE_ENV=production` (see `src/config/env.validation.ts`) — the app will
refuse to boot without it once deployed to production.

### Known limitation — Hobby plan cron frequency

**Vercel's Hobby plan only supports cron jobs that run once per day**, so
both schedules above are deliberately daily rather than matching the
Docker/Cloud Run cadence (`booking-expiry` hourly, `refund-processor` every 5
minutes). Practical effect on Vercel specifically: an expired pending booking
can sit unexpired for up to ~24h, and an eligible refund can sit unprocessed
for up to ~24h, before the next daily run picks it up. Neither job is
data-lossy — they only ever act on rows that are *already* past their
deadline — so this is a latency tradeoff, not a correctness one.

If that latency isn't acceptable, the options are: upgrade the Vercel
project to **Pro** (unlocks sub-daily cron schedules — restore `0 * * * *`
and `*/5 * * * *` at that point) or run the Docker/Cloud Run deploy instead,
where both jobs keep running on their original `setInterval` cadence
regardless of plan.

## 6. What the code already handles

- `api/index.ts` bootstraps Nest once per warm serverless function instance
  (no `app.listen()` — Vercel owns the HTTP listener) and reuses the same
  Express/Nest instance across warm invocations.
- `vercel.json` rewrites every path to `/api/index`; Nest's own
  `setGlobalPrefix('api/v1')` (applied in `src/bootstrap.ts`, shared by both
  the Docker and Vercel entry points) handles routing from there — no need to
  duplicate `/api/v1` in the rewrite.
- `vercel-build` (in `package.json`) runs `prisma generate && prisma migrate
  deploy && nest build` automatically on every Vercel deploy — idempotent,
  safe to run every time, applies any pending migrations against whatever
  `DATABASE_URL`/`DIRECT_URL` are configured for that deployment's
  environment.
- The `/uploads` static file route is intentionally **not** part of the
  Vercel path (see step 4 above) — it stays Docker/Cloud-Run-only in
  `src/main.ts`, since Vercel's filesystem is ephemeral and can't serve it.
- `STORAGE_PROVIDER=vercel-blob` swaps `STORAGE_SERVICE` to
  `VercelBlobStorageService` (see step 4 above); left unset, storage behavior
  is unchanged on every existing deploy.
- `CronModule` (see step 5 above) exposes the two background sweeps as
  `CronSecretGuard`-protected HTTP endpoints for Vercel Cron; the original
  `setInterval`-based scheduling in `BookingsExpiryJob`/`RefundsProcessorJob`
  is untouched and keeps running as before on the Docker/Cloud Run deploy.
