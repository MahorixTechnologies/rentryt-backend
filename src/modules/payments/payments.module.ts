import { Module } from '@nestjs/common';

import { FeeRulesService } from '../../common/fee-rules/fee-rules.service';
import { BookingsModule } from '../bookings/bookings.module';
import { ListingsModule } from '../listings/listings.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { FlutterwaveProvider } from './flutterwave.provider';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaystackProvider } from './paystack.provider';
import { RefundsProcessorJob } from './refunds-processor.job';

@Module({
  imports: [BookingsModule, ListingsModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentProviderRegistry,
    PaystackProvider,
    FlutterwaveProvider,
    FeeRulesService,
    RefundsProcessorJob,
  ],
  // PaymentsService exported so AdminModule can reuse PaymentsService.refund
  // for the manual POST /admin/payments/:id/refund endpoint instead of
  // duplicating it. RefundsProcessorJob exported so CronModule can invoke
  // handleRefundPendingBookings() directly from the Vercel Cron HTTP endpoint.
  exports: [PaymentsService, RefundsProcessorJob],
})
export class PaymentsModule {}
