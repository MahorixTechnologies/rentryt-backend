import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.string().default('dev-secret'),
  }),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  CORS_ORIGINS: Joi.string().optional(),
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
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().optional(),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SMTP_FROM: Joi.string().optional(),
}).unknown(true);
