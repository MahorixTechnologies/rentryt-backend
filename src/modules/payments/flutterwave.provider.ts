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

const FLUTTERWAVE_BASE_URL = 'https://api.flutterwave.com/v3';

/**
 * Flutterwave's `amount` is in the currency's main unit (whole naira, not
 * kobo) — unlike Paystack, no conversion happens here. Verifying requires
 * the numeric provider transaction id (from the redirect/webhook), not the
 * tx_ref we generated.
 */
@Injectable()
export class FlutterwaveProvider implements PaymentProviderAdapter {
  constructor(private readonly config: ConfigService) {}

  private secretKey(): string {
    return this.config.getOrThrow<string>('FLUTTERWAVE_SECRET_KEY');
  }

  async initialize(params: PaymentInitParams): Promise<PaymentInitResult> {
    const res = await fetch(`${FLUTTERWAVE_BASE_URL}/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref: params.reference,
        amount: params.amount,
        currency: params.currency,
        redirect_url: params.callbackUrl,
        customer: { email: params.email },
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== 'success') {
      throw new InternalServerErrorException(
        `Flutterwave initialize failed: ${body?.message ?? res.statusText}`,
      );
    }

    return { authorizationUrl: body.data.link };
  }

  async verify(params: PaymentVerifyParams): Promise<PaymentVerifyResult> {
    if (!params.providerTransactionId) {
      return { success: false, amount: 0, currency: '', raw: null };
    }

    const res = await fetch(
      `${FLUTTERWAVE_BASE_URL}/transactions/${encodeURIComponent(params.providerTransactionId)}/verify`,
      { headers: { Authorization: `Bearer ${this.secretKey()}` } },
    );

    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== 'success') {
      throw new InternalServerErrorException(
        `Flutterwave verify failed: ${body?.message ?? res.statusText}`,
      );
    }

    const data = body.data ?? {};
    return {
      success: data.status === 'successful' && data.tx_ref === params.reference,
      amount: typeof data.amount === 'number' ? data.amount : 0,
      currency: data.currency ?? '',
      raw: body,
    };
  }

  /**
   * Requires the numeric provider transaction id (from the redirect/webhook,
   * same id verify() uses) — Flutterwave's refund endpoint has no
   * reference-based lookup. We always refund the full original amount and
   * this codebase has no partial-refund concept, so `amount` is
   * deliberately omitted from the body — Flutterwave's own contract is
   * "omit amount for a full refund", the mirror image of Paystack, which
   * requires amount explicitly.
   */
  async refund(params: PaymentRefundParams): Promise<PaymentRefundResult> {
    if (!params.providerTransactionId) {
      throw new InternalServerErrorException(
        'Flutterwave refund requires a providerTransactionId',
      );
    }

    const res = await fetch(
      `${FLUTTERWAVE_BASE_URL}/transactions/${encodeURIComponent(params.providerTransactionId)}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );

    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== 'success') {
      throw new InternalServerErrorException(
        `Flutterwave refund failed: ${body?.message ?? res.statusText}`,
      );
    }

    return { success: true, raw: body };
  }

  /**
   * Flutterwave has no separate recipient-creation step — its transfer API
   * takes raw bank details per-transfer (see transfer()). PayoutsService
   * only calls this for a PAYSTACK account, so this is never actually
   * invoked for a Flutterwave account; it returns a clear failure rather
   * than silently no-op'ing, matching the interface's non-throwing contract
   * for payout methods.
   */
  async createTransferRecipient(
    _params: TransferRecipientParams,
  ): Promise<TransferRecipientResult> {
    return {
      success: false,
      raw: {
        message:
          'Flutterwave has no transfer-recipient step; pass account details directly to transfer()',
      },
    };
  }

  /**
   * `account_bank`/`account_number` are sent directly, no recipient lookup.
   * Like Paystack's transfer(), returns `{success: false, raw}` on rejection
   * rather than throwing — PayoutsService persists this as a FAILED Payout.
   */
  async transfer(params: TransferParams): Promise<TransferResult> {
    if (!params.accountNumber || !params.bankCode) {
      return {
        success: false,
        raw: {
          message:
            'accountNumber and bankCode are required for a Flutterwave transfer',
        },
      };
    }

    const res = await fetch(`${FLUTTERWAVE_BASE_URL}/transfers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_bank: params.bankCode,
        account_number: params.accountNumber,
        amount: params.amount,
        currency: params.currency,
        reference: params.reference,
        narration: params.narration ?? 'Payout',
      }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== 'success') {
      return { success: false, raw: body };
    }

    return {
      success: true,
      providerTransferId:
        body.data?.id != null ? String(body.data.id) : undefined,
      raw: body,
    };
  }
}
