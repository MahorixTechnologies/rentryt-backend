import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  EMAIL_PROVIDER,
  type EmailProviderAdapter,
  type EmailSendParams,
} from './email-provider.interface';

/**
 * Single call site the rest of the app uses to send email. Wraps the
 * configured EmailProviderAdapter and swallows send failures (logging them
 * instead of throwing) so a broken/misconfigured mail provider never breaks
 * a user-facing flow (registration, a booking status change, etc.) that
 * happens to also want to notify someone by email.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProviderAdapter,
  ) {}

  async send(params: EmailSendParams): Promise<void> {
    try {
      await this.provider.send(params);
    } catch (err) {
      this.logger.error(
        `failed to send email to ${params.to}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
