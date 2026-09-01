export type PaymentInitParams = {
  amount: number;
  currency: string;
  email: string;
  reference: string;
  callbackUrl: string;
};

export type PaymentInitResult = {
  authorizationUrl: string;
};

export type PaymentVerifyParams = {
  reference: string;
  providerTransactionId?: string;
};

export type PaymentVerifyResult = {
  success: boolean;
  amount: number;
  currency: string;
  raw: unknown;
};

export type PaymentRefundParams = {
  reference: string;
  providerTransactionId?: string;
  /** Whole-currency-unit amount (same convention as PaymentInitParams.amount) — always the full original payment amount, since this codebase has no partial-refund concept yet. */
  amount: number;
};

export type PaymentRefundResult = {
  success: boolean;
  raw: unknown;
};

export type TransferRecipientParams = {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  currency: string;
};

export type TransferRecipientResult = {
  success: boolean;
  /** Paystack's `recipient_code` — persisted on PayoutAccount.providerRecipientId. Present only when success is true. */
  recipientCode?: string;
  raw: unknown;
};

export type TransferParams = {
  reference: string;
  /** Whole-currency-unit amount (same convention as PaymentInitParams.amount). */
  amount: number;
  currency: string;
  narration?: string;
  /** Paystack: the transfer-recipient code from createTransferRecipient(). */
  recipientCode?: string;
  /** Flutterwave: raw bank account details, sent per-transfer with no recipient step. */
  accountNumber?: string;
  bankCode?: string;
};

export type TransferResult = {
  success: boolean;
  providerTransferId?: string;
  raw: unknown;
};

/**
 * One adapter per gateway (Paystack, Flutterwave) behind this interface, so
 * PaymentsService/PayoutsService never branch on provider name outside
 * PaymentProviderRegistry.
 *
 * Unlike initialize/verify/refund (which throw on a rejected response, since
 * their callers treat any failure as exceptional), createTransferRecipient
 * and transfer return `{success: false, raw}` instead of throwing — their
 * callers (PayoutsService) need to persist a clear failure state (an
 * unverified PayoutAccount, or a FAILED Payout with the provider error in
 * rawPayload) rather than 500 the request.
 */
export interface PaymentProviderAdapter {
  initialize(params: PaymentInitParams): Promise<PaymentInitResult>;
  verify(params: PaymentVerifyParams): Promise<PaymentVerifyResult>;
  refund(params: PaymentRefundParams): Promise<PaymentRefundResult>;
  /**
   * Paystack: creates a transfer recipient up front, whose recipient_code is
   * required by transfer(). Flutterwave has no such step — its
   * implementation returns `{success: false}` since PayoutsService never
   * calls this for a Flutterwave account.
   */
  createTransferRecipient(
    params: TransferRecipientParams,
  ): Promise<TransferRecipientResult>;
  transfer(params: TransferParams): Promise<TransferResult>;
}
