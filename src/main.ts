import { join } from 'path';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import express from 'express';

import { configureApp } from './bootstrap';

async function bootstrap() {
  // rawBody: true keeps req.rawBody available on every request (Nest's
  // built-in support) — needed to verify Paystack/Flutterwave webhook
  // signatures, which are computed over the exact raw bytes sent, not a
  // re-serialized JSON body.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);

  // Dev/self-host only — serves LocalStorageService's uploads. Deleted (not
  // adapted) once a real object-storage adapter (e.g. GCS) is swapped in
  // behind the STORAGE_SERVICE token, since Cloud Run's local disk is
  // ephemeral and not shared across instances.
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
