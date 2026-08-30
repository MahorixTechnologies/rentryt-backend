export const STORAGE_SERVICE = 'STORAGE_SERVICE';

/**
 * Storage backend seam. `LocalStorageService` is the only implementation
 * today; a future `GcsStorageService` implementing this same interface is a
 * drop-in swap behind the `STORAGE_SERVICE` token — no controller/route
 * changes needed elsewhere when that happens.
 */
export interface StorageService {
  upload(file: Express.Multer.File, key?: string): Promise<string>;
  delete(url: string): Promise<void>;
}
