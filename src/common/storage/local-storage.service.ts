import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';

import { Injectable } from '@nestjs/common';

import type { StorageService } from './storage.interface';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'listings');
const PUBLIC_PREFIX = '/uploads/listings';

function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Dev/self-host implementation of {@link StorageService} — writes to local
 * disk under `./uploads/listings`. Cloud Run's local disk is ephemeral and
 * not shared across instances, so this is not meant to survive a real
 * multi-instance cloud deploy; it exists so the upload flow works today and
 * the `STORAGE_SERVICE` seam has a real implementation to swap out later.
 */
@Injectable()
export class LocalStorageService implements StorageService {
  async upload(file: Express.Multer.File): Promise<string> {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}-${sanitizeFilename(file.originalname)}`;
    await fs.writeFile(join(UPLOAD_DIR, filename), file.buffer);
    return `${PUBLIC_PREFIX}/${filename}`;
  }

  async delete(url: string): Promise<void> {
    if (!url.startsWith(PUBLIC_PREFIX)) return;
    const filename = url.slice(PUBLIC_PREFIX.length + 1);
    if (!filename || filename.includes('/') || filename.includes('..')) return;
    await fs.rm(join(UPLOAD_DIR, filename), { force: true });
  }
}
