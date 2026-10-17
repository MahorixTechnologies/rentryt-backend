import { Injectable } from '@nestjs/common';
import { del, head, put } from '@vercel/blob';

import type {
  StoragePresignInput,
  StoragePresignResult,
  StorageService,
} from './storage.interface';
import { PRESIGN_TTL_SECONDS, buildObjectKey } from './storage.util';

/**
 * Vercel Blob fallback. Client uploads go through
 * `PUT /api/v1/storage/local/:key`, which calls `upload()`.
 */
@Injectable()
export class VercelBlobStorageService implements StorageService {
  async upload(file: Express.Multer.File, key?: string): Promise<string> {
    const pathname = key ?? buildObjectKey(file.originalname);
    const blob = await put(pathname, file.buffer, {
      access: 'public',
      contentType: file.mimetype,
    });
    return blob.url;
  }

  async delete(urlOrKey: string): Promise<void> {
    try {
      await del(urlOrKey);
    } catch {
      // Idempotent.
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await head(key);
      return true;
    } catch {
      return false;
    }
  }

  async presign(input: StoragePresignInput): Promise<StoragePresignResult> {
    const encoded = encodeURIComponent(input.key);
    return {
      uploadUrl: `${input.apiBase}/api/v1/storage/local/${encoded}`,
      publicUrl: `${input.apiBase}/api/v1/storage/local/${encoded}`,
      headers: { 'Content-Type': input.contentType },
      expiresIn: PRESIGN_TTL_SECONDS,
    };
  }
}
