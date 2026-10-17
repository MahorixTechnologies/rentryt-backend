import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import type {
  EmailProviderAdapter,
  EmailSendParams,
} from './email-provider.interface';

/**
 * Nodemailer-backed email sender, configured entirely from env vars. Two
 * mutually exclusive backends, checked in this order:
 *
 * 1. Gmail (EMAIL_USER + EMAIL_PASS) — EMAIL_PASS must be a 16-character
 *    Gmail App Password (Google Account → Security → App Passwords), not
 *    the account's normal login password; Gmail rejects plain-password SMTP
 *    auth outright when 2FA is on, and largely deprecated it even without.
 * 2. Generic SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).
 *
 * When neither is set — the expected case in dev/demo environments with no
 * real mail credentials — sends are logged to the console instead of
 * attempted over the network, so every flow that triggers an email keeps
 * working with zero configuration.
 */
@Injectable()
export class NodemailerEmailProvider implements EmailProviderAdapter {
  private readonly logger = new Logger(NodemailerEmailProvider.name);
  private transporter: Transporter | null = null;
  private defaultFrom = 'no-reply@rentryt.app';

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Transporter | null {
    if (this.transporter) return this.transporter;

    const emailUser = this.config.get<string>('EMAIL_USER');
    const emailPass = this.config.get<string>('EMAIL_PASS');
    if (emailUser && emailPass) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: emailUser, pass: emailPass },
      });
      this.defaultFrom = this.config.get<string>('SMTP_FROM', emailUser);
      return this.transporter;
    }

    const host = this.config.get<string>('SMTP_HOST');
    if (!host) return null;

    const port = this.config.get<number>('SMTP_PORT', 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
    });
    this.defaultFrom = this.config.get<string>('SMTP_FROM', this.defaultFrom);
    return this.transporter;
  }

  async send(params: EmailSendParams): Promise<void> {
    const transporter = this.getTransporter();
    if (!transporter) {
      this.logger.log(
        `[email:console-fallback] no EMAIL_USER/EMAIL_PASS or SMTP_HOST configured — would send to=${params.to} subject="${params.subject}"\n${params.text ?? params.html}`,
      );
      return;
    }

    await transporter.sendMail({
      from: this.defaultFrom,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  }
}
