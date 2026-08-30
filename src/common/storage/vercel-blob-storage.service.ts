import { randomUUID } from 'crypto';

import { Injectable } from '@nestjs/common';
import { del, put } from '@vercel/blob';

import type { StorageService } from './storage.interface';

const BLOB_PREFIX = 'listings/';

function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Vercel Blob implementation of {@link StorageService}, used when
 * `STORAGE_PROVIDER=vercel-blob` (see storage.module.ts). `put`/`del` read
 * `BLOB_READ_WRITE_TOKEN` from the environment automatically once a Blob
 * store is linked to the Vercel project — it is never passed explicitly
 * here.
 */
@Injectable()
export class VercelBlobStorageService implements StorageService {
  async upload(file: Express.Multer.File): Promise<string> {
    const pathname = `${BLOB_PREFIX}${randomUUID()}-${sanitizeFilename(file.originalname)}`;
    const blob = await put(pathname, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
    });
    return blob.url;
  }

  async delete(url: string): Promise<void> {
    await del(url);
  }
}
