import { Module } from '@nestjs/common';

import { LocalStorageService } from './local-storage.service';
import { STORAGE_SERVICE, type StorageService } from './storage.interface';
import { VercelBlobStorageService } from './vercel-blob-storage.service';

@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      useFactory: (): StorageService => {
        return process.env.STORAGE_PROVIDER === 'vercel-blob'
          ? new VercelBlobStorageService()
          : new LocalStorageService();
      },
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
