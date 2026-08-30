export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';

export type EmailSendParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * SMTP is the only backend today (see NodemailerEmailProvider). Kept as an
 * interface, mirroring PaymentProviderAdapter, so a future transactional
 * email API (SES, Postmark, etc.) is a drop-in swap behind the
 * EMAIL_PROVIDER token — no call site changes needed elsewhere.
 */
export interface EmailProviderAdapter {
  send(params: EmailSendParams): Promise<void>;
}
