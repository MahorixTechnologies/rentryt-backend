import { Module } from '@nestjs/common';

import { FeeRulesService } from '../../common/fee-rules/fee-rules.service';
import { NotificationsModule } from '../notifications/notifications.module';

import { BookingsExpiryJob } from './bookings-expiry.job';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService, FeeRulesService, BookingsExpiryJob],
  // BookingsExpiryJob exported so CronModule can invoke
  // handleExpiredPendingBookings() directly from the Vercel Cron HTTP endpoint.
  exports: [BookingsService, BookingsExpiryJob],
})
export class BookingsModule {}
