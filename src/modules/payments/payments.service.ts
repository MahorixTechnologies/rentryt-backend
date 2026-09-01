import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type {
  Currency,
  Payment,
  PaymentProvider,
  PaymentPurpose,
  Prisma,
} from '@prisma/client';

import { recordAuditLog } from '../../common/audit/audit-log';
import {
  FEATURED_LISTING_PRICE_DEFAULT,
  FEATURED_LISTING_PRICE_KEY,
  FeeRulesService,
} from '../../common/fee-rules/fee-rules.service';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { BookingsService } from '../bookings/bookings.service';
import { ListingsService } from '../listings/listings.service';
import {
  NotificationsService,
  NotificationType,
} from '../notifications/notifications.service';

import { PaymentProviderRegistry } from './payment-provider.registry';
import {
  verifyFlutterwaveSignature,
  verifyPaystackSignature,
} from './webhook-signature';

const MOBILE_CALLBACK_PREFIX = 'bluerockmobile://';

type InitiateParams = {
  purpose: PaymentPurpose;
  targetId: string;
  provider: PaymentProvider;
  callbackUrl: string;
};

type VerifyParams = {
  reference: string;
  providerTransactionId?: string;
  callerId?: string;
};

type RefundParams = {
  /** Manual path (POST /admin/payments/:id/refund): the Payment row's own id. */
  paymentId?: string;
  /** Automatic path (RefundsProcessorJob, driven off Booking.paymentStatus === 'REFUND_PENDING'). */
  bookingId?: string;
  /** null for the automated job — no human actor to attribute the refund to. */
  actorId: string | null;
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
    private readonly feeRules: FeeRulesService,
    private readonly bookings: BookingsService,
    private readonly listings: ListingsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The client supplies its own return URL (a web origin vs. a mobile deep
   * link) since only it knows which is appropriate. This is a lightweight
   * open-redirect guard, not a payment trust boundary — verify() always
   * re-checks with the provider independently regardless of this URL.
   */
  private assertCallbackUrlAllowed(callbackUrl: string) {
    if (process.env.NODE_ENV !== 'production') return;
    const webOrigins = (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    const allowed = [...webOrigins, MOBILE_CALLBACK_PREFIX];
    if (!allowed.some((prefix) => callbackUrl.startsWith(prefix))) {
      throw new BadRequestException('callbackUrl not allowed');
    }
  }

  async initiate(payer: AuthUser, params: InitiateParams) {
    this.assertCallbackUrlAllowed(params.callbackUrl);

    let amount: number;
    let currency: Currency;
    let bookingId: string | undefined;
    let listingId: string | undefined;
    let payerEmail: string;

    if (params.purpose === 'BOOKING') {
      const booking = await this.prisma.booking.findUnique({
        where: { id: params.targetId },
        include: {
          listing: { select: { currency: true } },
          renter: { select: { email: true } },
        },
      });
      if (!booking) throw new NotFoundException('booking not found');
      if (booking.renterId !== payer.id)
        throw new ForbiddenException('not allowed');
      if (booking.paymentStatus === 'PAID') {
        throw new BadRequestException('booking is already paid');
      }

      amount = booking.total;
      currency = booking.listing.currency;
      bookingId = booking.id;
      payerEmail = booking.renter.email;
    } else {
      const listing = await this.prisma.listing.findUnique({
        where: { id: params.targetId },
        include: { owner: { select: { email: true } } },
      });
      if (!listing) throw new NotFoundException('listing not found');
      if (payer.role !== UserRole.LANDLORD || listing.ownerId !== payer.id) {
        throw new ForbiddenException('not allowed');
      }
      if (listing.status !== 'APPROVED') {
        throw new BadRequestException('only approved listings can be featured');
      }

      amount = await this.feeRules.getValue(
        FEATURED_LISTING_PRICE_KEY,
        FEATURED_LISTING_PRICE_DEFAULT,
      );
      // Flat NGN-denominated fee regardless of the listing's own currency —
      // deliberately not `listing.currency` (a latent bug from the earlier
      // fake-pay version, now that this charges real money).
      currency = 'NGN';
      listingId = listing.id;
      payerEmail = listing.owner.email;
    }

    const reference = `${params.purpose.toLowerCase()}_${randomUUID()}`;

    const payment = await this.prisma.payment.create({
      data: {
        purpose: params.purpose,
        bookingId,
        listingId,
        payerId: payer.id,
        provider: params.provider,
        reference,
        amount,
        currency,
        status: 'INITIATED',
      },
    });

    const { authorizationUrl } = await this.providers
      .get(params.provider)
      .initialize({
        amount,
        currency,
        email: payerEmail,
        reference,
        callbackUrl: params.callbackUrl,
      });

    return { authorizationUrl, reference: payment.reference };
  }

  async verify(params: VerifyParams) {
    const payment = await this.prisma.payment.findUnique({
      where: { reference: params.reference },
    });
    if (!payment) throw new NotFoundException('payment not found');
    if (params.callerId && payment.payerId !== params.callerId) {
      throw new ForbiddenException('not allowed');
    }

    if (payment.status === 'SUCCESSFUL') {
      return { success: true, alreadyProcessed: true };
    }

    const result = await this.providers.get(payment.provider).verify({
      reference: payment.reference,
      providerTransactionId:
        params.providerTransactionId ??
        payment.providerTransactionId ??
        undefined,
    });

    const amountOk = Math.round(result.amount) >= payment.amount;
    const currencyOk = result.currency === payment.currency;

    if (!result.success || !amountOk || !currencyOk) {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'INITIATED' },
        data: {
          status: 'FAILED',
          rawPayload: result.raw as Prisma.InputJsonValue,
          providerTransactionId:
            params.providerTransactionId ?? payment.providerTransactionId,
        },
      });
      return { success: false };
    }

    // Guarded update: only the caller that actually flips INITIATED ->
    // SUCCESSFUL applies the completion effect, so a race between the
    // client's verify call and the async webhook can't double-apply it.
    const { count } = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'INITIATED' },
      data: {
        status: 'SUCCESSFUL',
        rawPayload: result.raw as Prisma.InputJsonValue,
        providerTransactionId:
          params.providerTransactionId ?? payment.providerTransactionId,
      },
    });

    if (count === 1) {
      await this.applyCompletion(payment);
    }

    return { success: true };
  }

  /**
   * Single source of truth for refunding a payment via the real provider
   * API — called both by the manual admin endpoint (paymentId) and by
   * RefundsProcessorJob for cancelled-but-paid bookings (bookingId, the
   * "REFUND_PENDING" marker BookingsService.cancel /
   * expireStalePendingBookings left). Idempotent: an already-REFUNDED
   * payment short-circuits, and the DB flip is a guarded updateMany keyed
   * on the current status (status: 'SUCCESSFUL') — the same pattern
   * verify() uses for INITIATED -> SUCCESSFUL — so a manual refund racing
   * the automatic job can't double-apply the completion effect.
   */
  async refund(
    params: RefundParams,
  ): Promise<{ success: boolean; alreadyRefunded?: boolean }> {
    if (!params.paymentId && !params.bookingId) {
      throw new BadRequestException('paymentId or bookingId is required');
    }

    const payment = params.paymentId
      ? await this.prisma.payment.findUnique({
          where: { id: params.paymentId },
        })
      : await this.prisma.payment.findFirst({
          where: {
            bookingId: params.bookingId,
            status: { in: ['SUCCESSFUL', 'REFUNDED'] },
          },
          orderBy: { createdAt: 'desc' },
        });

    if (!payment) throw new NotFoundException('payment not found');

    if (payment.status === 'REFUNDED') {
      return { success: true, alreadyRefunded: true };
    }
    if (payment.status !== 'SUCCESSFUL') {
      throw new BadRequestException(
        'only a successful payment can be refunded',
      );
    }

    const result = await this.providers.get(payment.provider).refund({
      reference: payment.reference,
      providerTransactionId: payment.providerTransactionId ?? undefined,
      amount: payment.amount,
    });

    if (!result.success) {
      throw new InternalServerErrorException(
        'refund was rejected by the payment provider',
      );
    }

    const { count } = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'SUCCESSFUL' },
      data: {
        status: 'REFUNDED',
        rawPayload: result.raw as Prisma.InputJsonValue,
      },
    });

    if (count === 1) {
      if (payment.bookingId) {
        await this.prisma.booking.updateMany({
          where: {
            id: payment.bookingId,
            paymentStatus: { in: ['PAID', 'REFUND_PENDING'] },
          },
          data: { paymentStatus: 'REFUNDED' },
        });
      }

      await recordAuditLog(this.prisma, {
        actorId: params.actorId,
        action: 'PAYMENT_REFUNDED',
        targetType: 'Payment',
        targetId: payment.id,
        metadata: {
          provider: payment.provider,
          amount: payment.amount,
          currency: payment.currency,
          bookingId: payment.bookingId,
          listingId: payment.listingId,
          automated: params.actorId === null,
        },
      });

      await this.notifications.notify(payment.payerId, {
        type: NotificationType.PAYMENT_REFUNDED,
        title: 'Refund processed',
        body: `Your payment of ${payment.amount} ${payment.currency} has been refunded.`,
        data: {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          amount: payment.amount,
        },
      });
    }

    return { success: true };
  }

  private async applyCompletion(payment: Payment) {
    if (payment.purpose === 'BOOKING' && payment.bookingId) {
      await this.bookings.markPaidAfterVerifiedPayment(payment.bookingId);
    } else if (payment.purpose === 'FEATURED_LISTING' && payment.listingId) {
      await this.listings.activateFeaturedListing(
        payment.listingId,
        payment.reference,
      );
    }
  }

  async handleWebhook(
    provider: PaymentProvider,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ) {
    if (provider === 'PAYSTACK') {
      const secret = process.env.PAYSTACK_SECRET_KEY ?? '';
      if (
        !verifyPaystackSignature(
          rawBody,
          headers['x-paystack-signature'],
          secret,
        )
      ) {
        throw new ForbiddenException('invalid signature');
      }
      const payload = JSON.parse(rawBody.toString('utf8'));
      const reference = payload?.data?.reference;
      if (typeof reference === 'string') {
        await this.verify({ reference }).catch(() => undefined);
      }
    } else {
      const secretHash = process.env.FLUTTERWAVE_SECRET_HASH ?? '';
      if (
        !verifyFlutterwaveSignature(
          rawBody,
          {
            'flutterwave-signature': headers['flutterwave-signature'],
            'verif-hash': headers['verif-hash'],
          },
          secretHash,
        )
      ) {
        throw new ForbiddenException('invalid signature');
      }
      const payload = JSON.parse(rawBody.toString('utf8'));
      const reference = payload?.data?.tx_ref;
      const providerTransactionId =
        payload?.data?.id != null ? String(payload.data.id) : undefined;
      if (typeof reference === 'string') {
        await this.verify({ reference, providerTransactionId }).catch(
          () => undefined,
        );
      }
    }

    return { received: true };
  }
}
