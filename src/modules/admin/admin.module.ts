import { Module } from '@nestjs/common';

import { ConversationsModule } from '../conversations/conversations.module';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payouts/payouts.module';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [PaymentsModule, PayoutsModule, ConversationsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
