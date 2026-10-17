import { Module } from '@nestjs/common';

import { LocalStorageService } from './local-storage.service';
import { R2StorageService } from './r2-storage.service';
import { STORAGE_SERVICE, type StorageService } from './storage.interface';
import { StorageSweepJob } from './storage-sweep.job';
import { StorageUploadsService } from './storage-uploads.service';
import { StorageController } from './storage.controller';
import { VercelBlobStorageService } from './vercel-blob-storage.service';

@Module({
  controllers: [StorageController],
  providers: [
    {
      provide: STORAGE_SERVICE,
      useFactory: (): StorageService => {
        const provider = process.env.STORAGE_PROVIDER;
        if (provider === 'r2') return new R2StorageService();
        if (provider === 'vercel-blob') return new VercelBlobStorageService();
        return new LocalStorageService();
      },
    },
    StorageUploadsService,
    StorageSweepJob,
  ],
  exports: [STORAGE_SERVICE, StorageUploadsService, StorageSweepJob],
})
export class StorageModule {}
