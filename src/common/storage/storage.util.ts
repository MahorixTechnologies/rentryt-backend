import { randomUUID } from 'crypto';

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const PRESIGN_TTL_SECONDS = 10 * 60;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const STORAGE_PURPOSE_LISTING_IMAGE = 'listing-image';

export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function buildObjectKey(filename: string): string {
  return `listings/${randomUUID()}-${sanitizeFilename(filename)}`;
}

export function extensionForContentType(contentType: string): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}
