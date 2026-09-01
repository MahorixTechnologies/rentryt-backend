import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { FlutterwaveProvider } from '../payments/flutterwave.provider';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import { PaystackProvider } from '../payments/paystack.provider';

import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PayoutsController],
  // PaymentProviderRegistry/PaystackProvider/FlutterwaveProvider are
  // redeclared here (not exported from PaymentsModule) so PayoutsModule
  // doesn't need to import PaymentsModule, which itself imports
  // BookingsModule — avoids a longer import chain for a dependency this
  // module only needs for the two provider adapters.
  providers: [
    PayoutsService,
    PaymentProviderRegistry,
    PaystackProvider,
    FlutterwaveProvider,
  ],
  // Exported so AdminModule can reuse PayoutsService.process for the admin
  // POST /admin/payouts/:id/process endpoint instead of duplicating it.
  exports: [PayoutsService],
})
export class PayoutsModule {}
