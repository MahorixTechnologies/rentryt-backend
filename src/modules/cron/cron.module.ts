import { Module } from '@nestjs/common';

import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';

import { CronController } from './cron.controller';

/**
 * Wires the Vercel-Cron-facing HTTP endpoints to the existing
 * BookingsExpiryJob / RefundsProcessorJob classes (each exported by its own
 * module below) — see cron.controller.ts.
 */
@Module({
  imports: [BookingsModule, PaymentsModule],
  controllers: [CronController],
})
export class CronModule {}
