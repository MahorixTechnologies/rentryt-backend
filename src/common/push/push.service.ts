import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  PUSH_PROVIDER,
  type PushProviderAdapter,
  type PushSendParams,
  type PushSendResult,
} from './push-provider.interface';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(PUSH_PROVIDER) private readonly provider: PushProviderAdapter,
  ) {}

  async send(params: PushSendParams): Promise<PushSendResult> {
    try {
      return await this.provider.send(params);
    } catch (err) {
      this.logger.error(
        `failed to send push "${params.title}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return { invalidTokens: [] };
    }
  }
}
