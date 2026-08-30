import { Injectable } from '@nestjs/common';
import type { PaymentProvider } from '@prisma/client';

import { FlutterwaveProvider } from './flutterwave.provider';
import type { PaymentProviderAdapter } from './payment-provider.interface';
import { PaystackProvider } from './paystack.provider';

/**
 * Unlike StorageService (one active backend at a time), both payment
 * providers are simultaneously available and selected per-request by the
 * payer — so this holds both adapters rather than picking one via DI token.
 */
@Injectable()
export class PaymentProviderRegistry {
  constructor(
    private readonly paystack: PaystackProvider,
    private readonly flutterwave: FlutterwaveProvider,
  ) {}

  get(provider: PaymentProvider): PaymentProviderAdapter {
    switch (provider) {
      case 'PAYSTACK':
        return this.paystack;
      case 'FLUTTERWAVE':
        return this.flutterwave;
    }
  }
}
