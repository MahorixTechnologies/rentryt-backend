import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

import { CronSecretGuard } from '../../common/guards/cron-secret.guard';
import { BookingsExpiryJob } from '../bookings/bookings-expiry.job';
import { RefundsProcessorJob } from '../payments/refunds-processor.job';

/**
 * HTTP-triggerable equivalents of the setInterval-based jobs in
 * BookingsExpiryJob / RefundsProcessorJob, for Vercel Cron — which has no
 * long-lived process to run a setInterval on. Reachable (given the app's
 * global `api/v1` prefix) at:
 *
 *   POST /api/v1/internal/cron/booking-expiry
 *   POST /api/v1/internal/cron/refund-processor
 *
 * Guarded only by CronSecretGuard (no JwtAuthGuard/RolesGuard — Vercel Cron
 * carries no user session, only the `Authorization: Bearer <CRON_SECRET>`
 * header Vercel itself attaches per vercel.json's "crons" config).
 *
 * Delegates to the existing job classes' methods directly rather than
 * duplicating BookingsService/PaymentsService logic — the setInterval-based
 * scheduling in those classes is untouched and keeps running as-is on the
 * Docker/Cloud-Run deploy.
 */
@Controller('internal/cron')
@UseGuards(CronSecretGuard)
export class CronController {
  constructor(
    private readonly bookingsExpiryJob: BookingsExpiryJob,
    private readonly refundsProcessorJob: RefundsProcessorJob,
  ) {}

  @Post('booking-expiry')
  @HttpCode(200)
  async bookingExpiry() {
    await this.bookingsExpiryJob.handleExpiredPendingBookings();
    return { ok: true, job: 'booking-expiry' };
  }

  @Post('refund-processor')
  @HttpCode(200)
  async refundProcessor() {
    await this.refundsProcessorJob.handleRefundPendingBookings();
    return { ok: true, job: 'refund-processor' };
  }
}
