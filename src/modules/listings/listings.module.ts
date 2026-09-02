import { Module } from '@nestjs/common';

import { OptionalViewerModule } from '../../common/auth/optional-viewer.module';
import { StorageModule } from '../../common/storage/storage.module';

import { ListingsController } from './listings.controller';
import { ListingsUploadController } from './listings-upload.controller';
import { ListingsService } from './listings.service';

@Module({
  imports: [StorageModule, OptionalViewerModule],
  controllers: [ListingsController, ListingsUploadController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
