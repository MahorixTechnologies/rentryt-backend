import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

/**
 * Shared Nest application configuration used by every entry point (the
 * long-running Docker/Cloud Run process in main.ts, and the Vercel
 * serverless function in api/index.ts). Applies everything main.ts used to
 * do EXCEPT app.listen() itself and the /uploads static middleware, which
 * stays main.ts-only (dev/self-host only — doesn't apply once Vercel Blob
 * is wired in, and Vercel's filesystem can't serve it anyway).
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.use(helmet());

  // Deliberately permissive for now — allow any origin regardless of
  // CORS_ORIGINS/NODE_ENV. `origin: true` reflects back whatever Origin the
  // request sent (not a literal "*"), which is required anyway for
  // `credentials: true` to work per the CORS spec. Tighten this back to the
  // CORS_ORIGINS-allowlist behavior (see git history) once the real
  // frontend origins are known and stable.
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
}
