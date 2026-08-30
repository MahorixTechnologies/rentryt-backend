import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

import { PaymentsService } from './payments.service';

/** Max REFUND_PENDING bookings processed per run — keeps a repeated sweep cheap. */
const REFUND_BATCH_SIZE = 200;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Frequent sweep (every 5 minutes — refunds are more time-sensitive than the
 * hourly BookingsExpiryJob) that finds bookings BookingsService.cancel /
 * expireStalePendingBookings marked `paymentStatus: 'REFUND_PENDING'` and
 * processes the real provider refund via PaymentsService.refund, so a
 * cancelled-but-paid booking ends up genuinely refunded rather than just
 * locally marked.
 *
 * Lives here (in PaymentsModule) rather than as a call from
 * BookingsService.cancel() itself to avoid a circular module dependency —
 * PaymentsModule already imports BookingsModule (for markPaidAfterVerifiedPayment),
 * so the reverse import would create one. PaymentsService.refund() is
 * idempotent (guarded updateMany keyed on the payment's current status), so
 * re-running this sweep on a booking already refunded by the manual admin
 * endpoint is a no-op, not a double-refund.
 *
 * Deliberately NOT using @nestjs/schedule: that package ships ESM-only
 * ("type": "module") and this app compiles to CommonJS, so `require()`-ing
 * it crashes on any Node runtime without CJS-require-of-ESM support
 * (confirmed broken on Vercel's Node runtime). A plain setInterval has no
 * such dependency. Only meaningful on a persistent process (the existing
 * Docker/Cloud-Run deploy) — on Vercel serverless this never fires at all,
 * which is why the equivalent logic is also exposed via a secured HTTP
 * endpoint for Vercel Cron to call instead.
 */
@Injectable()
export class RefundsProcessorJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefundsProcessorJob.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.handleRefundPendingBookings(), FIVE_MINUTES_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async handleRefundPendingBookings() {
    const pending = await this.prisma.booking.findMany({
      where: { paymentStatus: 'REFUND_PENDING' },
      select: { id: true },
      take: REFUND_BATCH_SIZE,
    });

    for (const booking of pending) {
      try {
        await this.payments.refund({ bookingId: booking.id, actorId: null });
      } catch (error) {
        this.logger.error(
          `Automatic refund failed for booking ${booking.id}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
  }
}
