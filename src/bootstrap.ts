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

  const corsOrigins = process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins?.length && process.env.NODE_ENV === 'production') {
    app.enableCors({ origin: corsOrigins, credentials: true });
  } else {
    app.enableCors({ origin: true, credentials: true });
  }
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
}
