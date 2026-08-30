import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { BookingsService } from './bookings.service';

/**
 * Hourly sweep for PENDING bookings whose startDate has passed without
 * ever being confirmed — see BookingsService.expireStalePendingBookings
 * for the actual query/transition logic; this class only wires it to the
 * scheduler.
 */
@Injectable()
export class BookingsExpiryJob {
  private readonly logger = new Logger(BookingsExpiryJob.name);

  constructor(private readonly bookings: BookingsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredPendingBookings() {
    try {
      await this.bookings.expireStalePendingBookings();
    } catch (error) {
      this.logger.error('Booking expiry sweep failed', error instanceof Error ? error.stack : error);
    }
  }
}
