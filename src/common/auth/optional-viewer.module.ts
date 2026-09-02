import { Module } from '@nestjs/common';

import { AuthModule } from '../../modules/auth/auth.module';

import { OptionalViewerService } from './optional-viewer.service';

@Module({
  imports: [AuthModule],
  providers: [OptionalViewerService],
  exports: [OptionalViewerService],
})
export class OptionalViewerModule {}
