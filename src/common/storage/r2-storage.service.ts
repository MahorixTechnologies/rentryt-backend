import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

import type {
  StoragePresignInput,
  StoragePresignResult,
  StorageService,
} from './storage.interface';
import { PRESIGN_TTL_SECONDS, buildObjectKey } from './storage.util';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when STORAGE_PROVIDER=r2`);
  }
  return value;
}

function publicBase(): string {
  return requiredEnv('R2_PUBLIC_BASE_URL').replace(/\/+$/, '');
}

function publicUrlForKey(key: string): string {
  return `${publicBase()}/${key}`;
}

function keyFromUrlOrKey(urlOrKey: string): string {
  const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? '';
  if (base && urlOrKey.startsWith(`${base}/`)) {
    return urlOrKey.slice(base.length + 1);
  }
  return urlOrKey.replace(/^\/+/, '');
}

@Injectable()
export class R2StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const accountId = requiredEnv('R2_ACCOUNT_ID');
    this.bucket = requiredEnv('R2_BUCKET');
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
      },
    });
  }

  async upload(file: Express.Multer.File, key?: string): Promise<string> {
    const objectKey = key ?? buildObjectKey(file.originalname);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    return publicUrlForKey(objectKey);
  }

  async delete(urlOrKey: string): Promise<void> {
    const key = keyFromUrlOrKey(urlOrKey);
    if (!key || key.includes('..')) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch {
      // Idempotent — missing object is success.
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async presign(input: StoragePresignInput): Promise<StoragePresignResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGN_TTL_SECONDS,
    });
    return {
      uploadUrl,
      publicUrl: publicUrlForKey(input.key),
      headers: { 'Content-Type': input.contentType },
      expiresIn: PRESIGN_TTL_SECONDS,
    };
  }
}
