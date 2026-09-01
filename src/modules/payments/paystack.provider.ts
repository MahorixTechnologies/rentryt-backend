import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  PaymentInitParams,
  PaymentInitResult,
  PaymentProviderAdapter,
  PaymentRefundParams,
  PaymentRefundResult,
  PaymentVerifyParams,
  PaymentVerifyResult,
  TransferParams,
  TransferRecipientParams,
  TransferRecipientResult,
  TransferResult,
} from './payment-provider.interface';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

/**
 * Paystack's `amount` is always in the currency's smallest unit (kobo for
 * NGN) — the only place that conversion happens, so the rest of the
 * payments module can work exclusively in whole-currency-unit amounts.
 */
@Injectable()
export class PaystackProvider implements PaymentProviderAdapter {
  constructor(private readonly config: ConfigService) {}

  private secretKey(): string {
    return this.config.getOrThrow<string>('PAYSTACK_SECRET_KEY');
  }

  async initialize(params: PaymentInitParams): Promise<PaymentInitResult> {
    const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: params.email,
        amount: Math.round(params.amount * 100),
        currency: params.currency,
        reference: params.reference,
        callback_url: params.callbackUrl,
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.status) {
      throw new InternalServerErrorException(
        `Paystack initialize failed: ${body?.message ?? res.statusText}`,
      );
    }

    return { authorizationUrl: body.data.authorization_url };
  }

  async verify(params: PaymentVerifyParams): Promise<PaymentVerifyResult> {
    const res = await fetch(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(params.reference)}`,
      { headers: { Authorization: `Bearer ${this.secretKey()}` } },
    );

    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.status) {
      throw new InternalServerErrorException(
        `Paystack verify failed: ${body?.message ?? res.statusText}`,
      );
    }

    const data = body.data ?? {};
    return {
      success: data.status === 'success',
      amount: typeof data.amount === 'number' ? data.amount / 100 : 0,
      currency: data.currency ?? '',
      raw: body,
    };
  }

  /**
   * `transaction` accepts either the reference we generated or Paystack's
   * numeric transaction id — prefer the numeric providerTransactionId
   * (recorded from verify()) when we have it, falling back to reference.
   */
  async refund(params: PaymentRefundParams): Promise<PaymentRefundResult> {
    const res = await fetch(`${PAYSTACK_BASE_URL}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transaction: params.providerTransactionId ?? params.reference,
        amount: Math.round(params.amount * 100),
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.status) {
      throw new InternalServerErrorException(
        `Paystack refund failed: ${body?.message ?? res.statusText}`,
      );
    }

    return { success: true, raw: body };
  }

  /**
   * Creates a Paystack "transfer recipient" — a prerequisite for
   * transfer(), which references it by recipient_code. Unlike
   * initialize/verify/refund, this doesn't throw on a rejected response:
   * PayoutsService.setup needs to persist an unverified PayoutAccount and
   * surface the provider's error message rather than 500.
   */
  async createTransferRecipient(
    params: TransferRecipientParams,
  ): Promise<TransferRecipientResult> {
    const res = await fetch(`${PAYSTACK_BASE_URL}/transferrecipient`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'nuban',
        name: params.accountName,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: params.currency,
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.status) {
      return { success: false, raw: body };
    }

    return {
      success: true,
      recipientCode: body.data?.recipient_code,
      raw: body,
    };
  }

  /**
   * `source: 'balance'` is the only supported source for a standard
   * Paystack account. Like createTransferRecipient, returns
   * `{success: false, raw}` on rejection rather than throwing — PayoutsService
   * persists this as a FAILED Payout instead of a 500.
   */
  async transfer(params: TransferParams): Promise<TransferResult> {
    const res = await fetch(`${PAYSTACK_BASE_URL}/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(params.amount * 100),
        recipient: params.recipientCode,
        reference: params.reference,
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.status) {
      return { success: false, raw: body };
    }

    return {
      success: true,
      providerTransferId:
        body.data?.transfer_code ??
        (body.data?.id != null ? String(body.data.id) : undefined),
      raw: body,
    };
  }
}
