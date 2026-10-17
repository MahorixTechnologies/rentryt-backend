import { promises as fs } from 'fs';
import { join } from 'path';

import { Injectable } from '@nestjs/common';

import type {
  StoragePresignInput,
  StoragePresignResult,
  StorageService,
} from './storage.interface';
import { PRESIGN_TTL_SECONDS, buildObjectKey } from './storage.util';

const UPLOADS_ROOT = join(process.cwd(), 'uploads');

function diskPathForKey(key: string): string {
  return join(UPLOADS_ROOT, key);
}

function publicUrlForKey(key: string): string {
  return `/uploads/${key}`;
}

function keyFromPublicUrl(url: string): string | null {
  const marker = '/uploads/';
  const index = url.indexOf(marker);
  if (index >= 0) return url.slice(index + marker.length);
  return null;
}

/**
 * Dev/self-host implementation — writes to `./uploads/<key>`.
 */
@Injectable()
export class LocalStorageService implements StorageService {
  async upload(file: Express.Multer.File, key?: string): Promise<string> {
    const objectKey = key ?? buildObjectKey(file.originalname);
    const dest = diskPathForKey(objectKey);
    await fs.mkdir(join(dest, '..'), { recursive: true });
    await fs.writeFile(dest, file.buffer);
    return publicUrlForKey(objectKey);
  }

  async delete(urlOrKey: string): Promise<void> {
    const key = keyFromPublicUrl(urlOrKey) ?? urlOrKey;
    if (!key || key.includes('..')) return;
    await fs.rm(diskPathForKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(diskPathForKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async presign(input: StoragePresignInput): Promise<StoragePresignResult> {
    const encoded = encodeURIComponent(input.key);
    return {
      uploadUrl: `${input.apiBase}/api/v1/storage/local/${encoded}`,
      publicUrl: `${input.apiBase}${publicUrlForKey(input.key)}`,
      headers: { 'Content-Type': input.contentType },
      expiresIn: PRESIGN_TTL_SECONDS,
    };
  }
}
