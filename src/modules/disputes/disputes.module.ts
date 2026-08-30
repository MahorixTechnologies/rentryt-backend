import { Module } from '@nestjs/common';

import { AdminDisputesController, DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

@Module({
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
