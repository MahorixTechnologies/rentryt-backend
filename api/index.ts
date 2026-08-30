import type { IncomingMessage, ServerResponse } from 'http';

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { INestApplication } from '@nestjs/common';
import express from 'express';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

// Vercel serverless entry point. Vercel owns the HTTP listening for this
// function and invokes the exported (req, res) handler per request — Nest
// never calls app.listen() here. The underlying Express instance and the
// Nest application it's bound to are bootstrapped once per lambda
// container and cached in this module-level variable so warm invocations
// reuse them instead of re-running Nest's module graph on every request.
const expressInstance = express();

let bootstrapPromise: Promise<INestApplication> | null = null;

function bootstrap(): Promise<INestApplication> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const app = await NestFactory.create(
        AppModule,
        new ExpressAdapter(expressInstance),
        { rawBody: true },
      );
      configureApp(app);
      await app.init();
      return app;
    })();
  }
  return bootstrapPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await bootstrap();
  expressInstance(req, res);
}
