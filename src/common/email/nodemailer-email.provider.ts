import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import type {
  EmailProviderAdapter,
  EmailSendParams,
} from './email-provider.interface';

/**
 * SMTP-backed email sender configured entirely from env vars (SMTP_HOST,
 * SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM). When SMTP_HOST is not set —
 * the expected case in dev/demo environments with no real mail credentials —
 * sends are logged to the console instead of attempted over the network, so
 * every flow that triggers an email keeps working with zero configuration.
 */
@Injectable()
export class NodemailerEmailProvider implements EmailProviderAdapter {
  private readonly logger = new Logger(NodemailerEmailProvider.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter | null {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) return null;

    if (!this.transporter) {
      const port = this.config.get<number>('SMTP_PORT', 587);
      const user = this.config.get<string>('SMTP_USER');
      const pass = this.config.get<string>('SMTP_PASS');
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
      });
    }

    return this.transporter;
  }

  async send(params: EmailSendParams): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.log(
        `[email:console-fallback] SMTP_HOST not configured — would send to=${params.to} subject="${params.subject}"\n${params.text ?? params.html}`,
      );
      return;
    }

    const from = this.config.get<string>('SMTP_FROM', 'no-reply@bluerock.app');
    await transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  }
}
