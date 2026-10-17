export const STORAGE_SERVICE = 'STORAGE_SERVICE';

export type StoragePresignInput = {
  key: string;
  contentType: string;
  filename: string;
  apiBase: string;
};

export type StoragePresignResult = {
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
  expiresIn: number;
};

/**
 * Storage backend seam. Implementations: local disk, Cloudflare R2,
 * Vercel Blob. Controllers talk to StorageUploadsService; this token is
 * the byte-store underneath.
 */
export interface StorageService {
  upload(file: Express.Multer.File, key?: string): Promise<string>;
  delete(urlOrKey: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  presign(input: StoragePresignInput): Promise<StoragePresignResult>;
}
