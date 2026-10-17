import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  // Direct (unpooled) connection string, used only by `prisma migrate`.
  // Required in production (Vercel/serverless: DATABASE_URL is the pooled
  // connection the app queries through; DATABASE_URL_UNPOOLED is the direct
  // one migrations run over). Optional otherwise — local dev typically
  // points at a single non-pooled Postgres, so DATABASE_URL alone is enough.
  DATABASE_URL_UNPOOLED: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().optional(),
  }),
  JWT_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('dev-secret'),
  }),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  CORS_ORIGINS: Joi.string().optional(),
  // Storage backend seam (see src/common/storage). 'local' (default) writes
  // to disk under ./uploads — unchanged Docker/self-host/local-dev
  // behavior. 'vercel-blob' switches STORAGE_SERVICE to
  // VercelBlobStorageService for the Vercel serverless deploy.
  STORAGE_PROVIDER: Joi.string()
    .valid('local', 'r2', 'vercel-blob')
    .default('local'),
  // Vercel auto-populates this once a Blob store is linked to the project —
  // it is not a token you create by hand. Required only when actually
  // using the vercel-blob provider in production; optional otherwise so
  // local dev and the Docker path (which never sets STORAGE_PROVIDER) are
  // unaffected.
  BLOB_READ_WRITE_TOKEN: Joi.string().when('STORAGE_PROVIDER', {
    is: 'vercel-blob',
    then: Joi.string().when('NODE_ENV', {
      is: 'production',
      then: Joi.required(),
      otherwise: Joi.string().optional(),
    }),
    otherwise: Joi.string().optional(),
  }),
  R2_ACCOUNT_ID: Joi.string().when('STORAGE_PROVIDER', {
    is: 'r2',
    then: Joi.required(),
    otherwise: Joi.string().optional(),
  }),
  R2_ACCESS_KEY_ID: Joi.string().when('STORAGE_PROVIDER', {
    is: 'r2',
    then: Joi.required(),
    otherwise: Joi.string().optional(),
  }),
  R2_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_PROVIDER', {
    is: 'r2',
    then: Joi.required(),
    otherwise: Joi.string().optional(),
  }),
  R2_BUCKET: Joi.string().when('STORAGE_PROVIDER', {
    is: 'r2',
    then: Joi.required(),
    otherwise: Joi.string().optional(),
  }),
  R2_PUBLIC_BASE_URL: Joi.string().when('STORAGE_PROVIDER', {
    is: 'r2',
    then: Joi.required(),
    otherwise: Joi.string().optional(),
  }),
  PAYSTACK_SECRET_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('sk_test_placeholder'),
  }),
  FLUTTERWAVE_SECRET_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('FLWSECK_TEST-placeholder'),
  }),
  FLUTTERWAVE_SECRET_HASH: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('dev-secret-hash'),
  }),
  // Optional in every environment (including production): when SMTP_HOST is
  // absent, EmailService/NodemailerEmailProvider fall back to logging the
  // would-be email instead of sending it, so the app boots and every flow
  // that triggers an email keeps working with no mail credentials at all.
  // Checked by CronSecretGuard (src/common/guards/cron-secret.guard.ts) against
  // the `Authorization: Bearer <CRON_SECRET>` header Vercel automatically
  // attaches to requests it makes to the paths listed in vercel.json's
  // "crons" array. Required in production so the /internal/cron/* endpoints
  // are never left reachable without a secret configured.
  CRON_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().optional(),
  }),
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SMTP_FROM: Joi.string().optional(),
  // Gmail-service shortcut for NodemailerEmailProvider — checked before
  // SMTP_HOST. EMAIL_PASS must be a Gmail App Password, not the account
  // login password. Optional in every environment: EmailService falls back
  // to console-logging when neither this nor SMTP_HOST is set.
  EMAIL_USER: Joi.string().optional(),
  EMAIL_PASS: Joi.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: Joi.string().optional(),
}).unknown(true);
