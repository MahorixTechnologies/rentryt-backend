import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { BookingsService } from './bookings.service';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Hourly sweep for PENDING bookings whose startDate has passed without
 * ever being confirmed — see BookingsService.expireStalePendingBookings
 * for the actual query/transition logic; this class only wires it to a
 * plain interval.
 *
 * Deliberately NOT using @nestjs/schedule: that package ships ESM-only
 * ("type": "module") and this app compiles to CommonJS, so `require()`-ing
 * it crashes on any Node runtime without CJS-require-of-ESM support
 * (confirmed broken on Vercel's Node runtime, works only on newer local
 * Node versions that happen to support it). A plain setInterval has no such
 * dependency. Only meaningful on a persistent process (the existing
 * Docker/Cloud-Run deploy) — on Vercel serverless, this never fires at all,
 * which is why the equivalent logic is also exposed via a secured HTTP
 * endpoint for Vercel Cron to call instead.
 */
@Injectable()
export class BookingsExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingsExpiryJob.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly bookings: BookingsService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.handleExpiredPendingBookings(), ONE_HOUR_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async handleExpiredPendingBookings() {
    try {
      await this.bookings.expireStalePendingBookings();
    } catch (error) {
      this.logger.error('Booking expiry sweep failed', error instanceof Error ? error.stack : error);
    }
  }
}
