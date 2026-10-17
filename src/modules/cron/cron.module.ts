import { Module } from '@nestjs/common';

import { StorageModule } from '../../common/storage/storage.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';

import { CronController } from './cron.controller';

/**
 * Wires the Vercel-Cron-facing HTTP endpoints to the existing
 * BookingsExpiryJob / RefundsProcessorJob / StorageSweepJob classes.
 */
@Module({
  imports: [BookingsModule, PaymentsModule, StorageModule],
  controllers: [CronController],
})
export class CronModule {}
