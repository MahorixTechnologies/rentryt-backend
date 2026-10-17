import { Module } from '@nestjs/common';

import { EmailModule } from '../../common/email/email.module';
import { PushModule } from '../../common/push/push.module';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [EmailModule, PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
