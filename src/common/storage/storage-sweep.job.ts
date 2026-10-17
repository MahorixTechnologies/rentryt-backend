import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { StorageUploadsService } from './storage-uploads.service';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

@Injectable()
export class StorageSweepJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageSweepJob.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly uploads: StorageUploadsService) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.handleAbandonedUploads(),
      FIFTEEN_MINUTES_MS,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async handleAbandonedUploads() {
    try {
      const result = await this.uploads.sweepExpired();
      if (result.swept > 0) {
        this.logger.log(`Swept ${result.swept} abandoned uploads`);
      }
    } catch (error) {
      this.logger.error(
        'Storage sweep failed',
        error instanceof Error ? error.stack : error,
      );
    }
  }
}
