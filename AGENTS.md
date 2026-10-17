# Rentryt Backend · AGENTS.md

> Living playbook for anyone — human or agent — working in `rentryt-backend`.
> Stick to the patterns below so the API stays contract-stable with `rentryt-mobile`, `rentryt-web`, and `rentryt-admin`.

---

## 1. Stack & Versions (read this first)

| Area | Package / Version |
|---|---|
| Framework | **NestJS 11** (CLI v11, core v11) |
| Language | **TypeScript 5.7.3** |
| ORM | **Prisma 6.19.3** with Postgres provider |
| DB | **PostgreSQL** (Docker image via `docker-compose.yml`) |
| Auth | **Passport-JWT 4** + `@nestjs/jwt` 11 (bcrypt for passwords) |
| Security | `helmet 8`, `@nestjs/throttler 6`, Joi validation |
| Env | `@nestjs/config 4` with Joi schema validation |
| Tests | **Jest 30** + `ts-jest` + `supertest` for e2e |
| Build | `nest build` → outputs to `dist/` |

---

## 2. Project Structure

```
rentryt-backend/
├── prisma/
│   ├── migrations/           # committed migration files
│   ├── schema.prisma         # Prisma schema: models + enums
│   └── seed.ts               # idempotent seed (upserts users/listings/bookings)
├── src/
│   ├── common/
│   │   ├── decorators/       # @AuthUser(), @Roles()
│   │   ├── filters/          # http-exception.filter.ts (standard error JSON)
│   │   ├── guards/           # JwtAuthGuard, RolesGuard
│   │   ├── interceptors/     # ResponseInterceptor ({success, data, message})
│   │   ├── storage/          # R2 / local / vercel-blob adapters + upload sessions
│   │   └── types/auth.ts
│   ├── config/
│   │   └── env.validation.ts # Joi env schema
│   ├── modules/
│   │   ├── admin/            # admin.controller / service / module (ADMIN gating)
│   │   ├── auth/             # login, register, forgot-password, jwt.strategy
│   │   ├── bookings/         # bookings endpoints (create/list/me)
│   │   ├── listings/         # listings search + crud
│   │   ├── reviews/          # listing reviews
│   │   └── users/            # /users/me + profile endpoints
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── app.controller.ts / .spec.ts
│   ├── app.module.ts         # root module (imports all feature modules)
│   ├── app.service.ts
│   └── main.ts               # bootstrap: global prefix /api/v1, helmet, cors, filters, interceptor
├── test/                     # e2e spec + jest config
├── Dockerfile
├── docker-compose.yml        # `db` service + `api` service
├── .env.example
├── .prettierrc
├── eslint.config.mjs
├── nest-cli.json
├── tsconfig.json
└── package.json
```

---

## 3. Runtime Contracts

### 3.1 Global prefix & envelope

All controllers live under `/api/v1`.

```ts
// main.ts
app.setGlobalPrefix('api/v1');
```

Every successful **non-streaming** JSON response is wrapped by `ResponseInterceptor`:

```json
{ "success": true, "data": { ... }, "message": "..." }
```

All client SDKs (`lib/api-client.ts` in mobile) **auto-unwrap** this envelope. If you skip the interceptor for a route, add a comment and update all three clients accordingly — otherwise they will throw "missing token / data".

### 3.2 Error format

`HttpExceptionFilter` normalizes any error (including Nest validation, 401, 403, 404, business) into:

```json
{ "success": false, "message": "..." }
```

HTTP status code is still set properly (400/401/403/404/500). Clients read `message` and throw.

### 3.3 CORS & Helmet

Both are enabled globally. CORS is currently permissive (`app.enableCors()` with no origin restrictions) because the web/admin/mobile all originate from different hosts in local dev. Do not tighten CORS to a single origin during `npm run dev` without adding an env-configured allow-list.

---

## 4. Prisma Rules

### 4.1 Schema

All data modeling happens in `prisma/schema.prisma`. Read the existing schema first — it already defines:

| Entity | Prisma Model |
|---|---|
| User | `User` (role: RENTER | LANDLORD | ADMIN) |
| Listing | `Listing` (owner → User, type: House/Apartment, status: PENDING/APPROVED/REJECTED) |
| Booking | `Booking` (listing, renter, subtotal/serviceFee/total, BookingStatus, PaymentStatus) |
| Review | `Review` (listing, renter, rating, body) |
| Token | `Token` (EMAIL_VERIFY / PASSWORD_RESET, 6-digit numeric `token` (OTP, not globally unique — looked up by `userId`+`type`), `attempts`, expiresAt, usedAt) |

### 4.2 Migrations

- **Never hand-edit `migrations/` SQL.** Always:
  ```bash
  cd rentryt-backend
  npx prisma migrate dev --name <short-description>
  ```
- To apply migrations in prod: `prisma migrate deploy`
- `prisma generate` regenerates `@prisma/client` — run after any schema change.

### 4.3 Seed

`prisma/seed.ts` is **idempotent**. It uses `upsert` and `skipDuplicates` patterns so running it twice does not break seeded credentials. Running:

```bash
npm run prisma:seed
```

Creates these accounts (they are shared with mobile, web, and admin):

```
admin@rentryt.com    / admin123     (ADMIN)
landlord@rentryt.com / landlord123  (LANDLORD)
renter@rentryt.com   / renter123    (RENTER)
+ suspended user + bookings + listings (Aurora Retreat, Palmview Estate, The Courtyard Villa, etc.)
```

If you add new entities to the schema, add seeding for them to keep 1-click parity with the three client apps.

---

## 5. Feature Module Rules

Every new domain follows this pattern:

```
src/modules/<feature>/
├── <feature>.controller.ts   # HTTP layer only — DTOs, guards, return value shape
├── <feature>.service.ts      # business logic — only touches PrismaService
└── <feature>.module.ts       # Nest module: imports, providers, controllers, exports
```

The module must be imported in `app.module.ts`.

### 5.1 Controller responsibilities

- Accept HTTP params/body/query.
- Apply guards (`@UseGuards(JwtAuthGuard, RolesGuard)` where needed).
- Apply role decorators `@Roles(UserRole.ADMIN)` on admin-only endpoints.
- Delegate 100% of business logic to the service.

### 5.2 Service responsibilities

- Receive plain values (not Express/Nest DTOs).
- Use `PrismaService.<model>.findMany/upsert/transaction`.
- Throw `HttpException` subclasses on domain errors (400, 404, 403, 409).

### 5.3 Authentication guards

- `JwtAuthGuard` — requires a valid `Authorization: Bearer <jwt>` header.
- `RolesGuard` — checks `@Roles(...)` decorator against `user.role` from the JWT payload.

### 5.4 Decorators

- `@AuthUser()` — inject the JWT decoded user. Use it instead of hand-parsing request.user.
- `@Roles(UserRole.ADMIN)` — restrict endpoint to a role. Must be paired with `RolesGuard`.

---

## 6. Public API Surface

### 6.1 Auth

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/auth/register` | none | creates an unverified User + returns `{user}` (**no accessToken** — registering does not sign in); emails a 6-digit EMAIL_VERIFY code |
| `POST` | `/auth/login` | none | issues `{accessToken, user}` from credentials; throws 403 `"email not verified"` if `emailVerified` is false, regardless of correct password |
| `POST` | `/auth/request-email-verification` | none | `{email}` → (re)issues + emails a fresh 6-digit code |
| `POST` | `/auth/verify-email` | none | `{email, code}` → marks `User.emailVerified = true` and returns `{accessToken, user}`, since this is the first moment a fresh registration becomes a real session |
| `POST` | `/auth/forgot-password` | none | `{email}` → issues + emails a 6-digit PASSWORD_RESET code |
| `POST` | `/auth/reset-password` | none | `{email, code, newPassword}` → consume code + set new hash |

### 6.2 Users

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/users/me` | JWT | current profile |
| `PATCH` | `/users/me` | JWT | update name / phone |

### 6.2b Notifications & device tokens (`notifications.controller.ts`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/users/me/notifications` | JWT | in-app notification inbox |
| `PATCH` | `/users/me/notifications/:id/read` | JWT | mark one notification read |
| `POST` | `/users/me/device-tokens` | JWT | `{ token, platform: 'IOS' \| 'ANDROID' \| 'WEB' }` upsert FCM/APNs token |
| `DELETE` | `/users/me/device-tokens` | JWT | `{ token }` unregister this device |

`NotificationsService.notify()` is the single fan-out: it writes the in-app row, emails (best-effort), and sends FCM (best-effort) to every stored device token. OTP types (`EMAIL_VERIFICATION`, `PHONE_VERIFICATION`, `PASSWORD_RESET`) skip push so codes never land on a lock screen. FCM is optional — when `FIREBASE_SERVICE_ACCOUNT_JSON` / `FIREBASE_SERVICE_ACCOUNT_PATH` are unset, push is logged and skipped, same pattern as SMTP.

### 6.3 Listings

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/listings` | none | public listing search with filters |
| `GET` | `/listings/:id` | none | single listing detail |
| `POST` | `/listings` | LANDLORD JWT | create listing (status PENDING by default) |
| `PATCH` | `/listings/:id` | Owner / ADMIN | update listing |

### 6.3b Storage (`storage.controller.ts`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/storage/uploads` | LANDLORD / ADMIN JWT | create a `PENDING` `StorageObject` + return a 10-minute presign (`{ id, key, uploadUrl, publicUrl, headers, expiresIn }`). `contentType` must be `image/jpeg\|png\|webp`; `purpose` is `listing-image` |
| `POST` | `/storage/uploads/:id/complete` | owner | HEAD/exists check, mark `UPLOADED` |
| `DELETE` | `/storage/uploads/:id` | owner | `DeleteObject` + mark `ABORTED` (PENDING/UPLOADED only; attached images go through listing update) |
| `PUT` | `/storage/local/:encodedKey` | owner of that key | local-dev / vercel-blob body upload only |
| `POST` | `/internal/cron/storage-sweep` | cron secret | delete `PENDING`/`UPLOADED` rows past `expiresAt` |

`STORAGE_PROVIDER=local \| r2 \| vercel-blob` (default `local`). R2 is the documented cloud path: clients PUT directly to the presigned URL. Local and vercel-blob reuse `PUT /storage/local/:key`. Listing create/update calls `syncListingImages` — matching owned URLs become `ATTACHED`; dropped listing URLs are deleted. Archiving a listing does **not** delete objects.

R2 bucket CORS must allow `PUT` and `HEAD` from the web origin (`*` or the app origin for mobile). Add a lifecycle rule to abort incomplete multipart uploads after 1 day.

### 6.4 Bookings

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/bookings/me` | RENTER JWT | bookings for current user |
| `POST` | `/bookings` | RENTER JWT | create booking + compute service fee |

### 6.5 Admin (require ADMIN role)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/admin/users` | ADMIN JWT | list users |
| `GET` | `/admin/users/:id` | ADMIN JWT | single user detail (used by admin "View user") |
| `PATCH` | `/admin/users/:id/status` | ADMIN JWT | set ACTIVE / SUSPENDED |
| `GET` | `/admin/listings` | ADMIN JWT | list listings for moderation |
| `PATCH` | `/admin/listings/:id/status` | ADMIN JWT | approve / reject listings |
| `GET` | `/admin/bookings` | ADMIN JWT | list platform bookings |

If the admin UI adds a new view, add the corresponding admin endpoint BEFORE wiring it on the client. Do NOT expose user/listings endpoints directly with elevated privileges; create a specific `/admin/*` route.

---

## 7. Service Charge & Money

- Bookings have `subtotal`, `serviceFee`, `total`.
- The backend is authoritative for service fee. Today it is a flat percentage defined inside the bookings service; in the future it may come from admin settings.
- Admin UI allows overriding a `serviceCharge` value in `localStorage` for reports/income preview. **This is preview-only.** The real fee is what the backend calculates on booking create.
- Currency is modeled on Listing as `NGN | USD` and propagated to Booking. Formatting is done client-side.

---

## 8. Docker & Local Runtime

Two paths:

### 8.1 DB only (fastest)

```bash
cd rentryt-backend
cp .env.example .env
npm run db:up            # docker compose up -d db → postgres on 5432
npm run prisma:migrate:dev
npm run prisma:seed
npm run start:dev        # Nest on :3000
```

### 8.2 Full stack in Docker

```bash
npm run docker:up        # db + api containers
```

Docker daemon must be running. Without it `docker compose` commands will fail.

---

## 9. Running & Verifying

```bash
cd rentryt-backend
npm install

# lint / format
npm run lint
npm run format

# build (production)
npm run build

# unit tests
npm run test
npm run test:watch
npm run test:cov

# e2e
npm run test:e2e

# Prisma
npm run prisma:generate
npm run prisma:migrate:dev
npm run prisma:migrate:deploy
npm run prisma:seed
npm run prisma:studio
```

The de facto verification chain before committing a backend change:
1. `prisma generate` (if schema changed)
2. `npm run prisma:migrate:dev` (apply schema)
3. `npm run build` → must pass
4. `npm run test` → should pass or at least not regress new failures
5. Run one of the apps against the API to confirm contract stability

---

## 10. Things You Will NOT Do

- Do **not** add an endpoint without wrapping it in `ResponseInterceptor`/`HttpExceptionFilter` (global, so free) — except for health / binary streams.
- Do **not** make breaking changes to the `/api/v1` contract; all three clients depend on exact field names (`accessToken`, `user.role`, `data.items`, etc.).
- Do **not** remove seeded credentials without updating this AGENTS.md and all three client AGENTS.md files.
- Do **not** store plaintext passwords. Always use `bcrypt.hash()` via the Auth service pattern.
- Do **not** elevate an endpoint to ADMIN-only without both `@Roles(ADMIN)` and `@UseGuards(JwtAuthGuard, RolesGuard)`.
- Do **not** hand-write SQL; use Prisma query builders.
- Do **not** add comments in business logic code unless explicitly requested.
- Do **not** return the User entity with `passwordHash` in any controller — explicitly `select: { passwordHash: false }` or strip it.

---

## 11. Environment Variables

From `.env.example`:

```
PORT=3000
DATABASE_URL="postgresql://rentryt:rentryt@localhost:5432/rentryt?schema=public"
JWT_SECRET="change-me-to-a-long-random-string"
JWT_EXPIRES_IN="7d"
CORS_ORIGIN="*"
STORAGE_PROVIDER=local
```

- `JWT_SECRET` must be non-default in production.
- `DATABASE_URL` host is `localhost` for host-level runs, `db` when running inside docker compose api service.
- Firebase is optional. Set `FIREBASE_SERVICE_ACCOUNT_JSON` (inline service-account JSON) or `FIREBASE_SERVICE_ACCOUNT_PATH` (path to the downloaded `firebase-adminsdk-*.json`). Without either, in-app + email notifications still work and FCM is skipped.
- `STORAGE_PROVIDER` defaults to `local` (disk under `./uploads`). Production should use `r2` plus `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL`. Missing R2 keys fail Joi at boot when the provider is `r2`. `vercel-blob` remains a fallback.
