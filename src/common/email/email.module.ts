import { Module } from '@nestjs/common';

import { EMAIL_PROVIDER } from './email-provider.interface';
import { EmailService } from './email.service';
import { NodemailerEmailProvider } from './nodemailer-email.provider';

@Module({
  providers: [
    { provide: EMAIL_PROVIDER, useClass: NodemailerEmailProvider },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
