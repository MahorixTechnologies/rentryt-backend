import { Module } from '@nestjs/common';

import { FirebasePushProvider } from './firebase-push.provider';
import { PUSH_PROVIDER } from './push-provider.interface';
import { PushService } from './push.service';

@Module({
  providers: [
    { provide: PUSH_PROVIDER, useClass: FirebasePushProvider },
    PushService,
  ],
  exports: [PushService],
})
export class PushModule {}
