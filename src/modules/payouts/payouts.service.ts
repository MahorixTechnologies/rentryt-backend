import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentProvider, PayoutStatus, Prisma } from '@prisma/client';

import { recordAuditLog } from '../../common/audit/audit-log';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';

const PAYOUT_STATUSES: readonly PayoutStatus[] = ['PENDING', 'PROCESSING', 'PAID', 'FAILED'];

type SetupParams = {
  provider: PaymentProvider;
  bankCode: string;
  accountNumber: string;
  accountName: string;
};

function extractErrorMessage(raw: unknown): string {
  if (raw && typeof raw === 'object' && 'message' in raw) {
    const message = (raw as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return 'unknown error';
}

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderRegistry,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Upsert — a landlord can redo their setup at any time (e.g. to switch
   * provider or correct a bank detail). PAYSTACK requires creating a
   * transfer recipient up front (see PaystackProvider.createTransferRecipient);
   * FLUTTERWAVE has no such step, so it's verified immediately.
   */
  async setup(owner: AuthUser, params: SetupParams) {
    if (owner.role !== UserRole.LANDLORD) {
      throw new ForbiddenException('landlords only');
    }

    if (params.provider === 'FLUTTERWAVE') {
      const account = await this.prisma.payoutAccount.upsert({
        where: { ownerId: owner.id },
        create: {
          ownerId: owner.id,
          provider: params.provider,
          bankCode: params.bankCode,
          accountNumber: params.accountNumber,
          accountName: params.accountName,
          verified: true,
        },
        update: {
          provider: params.provider,
          bankCode: params.bankCode,
          accountNumber: params.accountNumber,
          accountName: params.accountName,
          verified: true,
          providerRecipientId: null,
        },
      });

      await recordAuditLog(this.prisma, {
        actorId: owner.id,
        action: 'PAYOUT_ACCOUNT_SETUP',
        targetType: 'PayoutAccount',
        targetId: account.id,
        metadata: { provider: params.provider, verified: true },
      });

      return account;
    }

    // PAYSTACK: create the transfer recipient first — its recipient_code is
    // required by transfer() later. createTransferRecipient returns
    // {success:false} rather than throwing on rejection (see
    // payment-provider.interface.ts), so on failure we still persist the
    // submitted bank details (verified: false, no recipientId) and surface
    // the provider's own error message to the caller.
    const result = await this.providers.get('PAYSTACK').createTransferRecipient({
      accountNumber: params.accountNumber,
      bankCode: params.bankCode,
      accountName: params.accountName,
      currency: 'NGN',
    });

    if (!result.success) {
      await this.prisma.payoutAccount.upsert({
        where: { ownerId: owner.id },
        create: {
          ownerId: owner.id,
          provider: params.provider,
          bankCode: params.bankCode,
          accountNumber: params.accountNumber,
          accountName: params.accountName,
          verified: false,
        },
        update: {
          provider: params.provider,
          bankCode: params.bankCode,
          accountNumber: params.accountNumber,
          accountName: params.accountName,
          verified: false,
          providerRecipientId: null,
        },
      });

      throw new BadRequestException(
        `Paystack transfer recipient setup failed: ${extractErrorMessage(result.raw)}`,
      );
    }

    const account = await this.prisma.payoutAccount.upsert({
      where: { ownerId: owner.id },
      create: {
        ownerId: owner.id,
        provider: params.provider,
        bankCode: params.bankCode,
        accountNumber: params.accountNumber,
        accountName: params.accountName,
        providerRecipientId: result.recipientCode,
        verified: true,
      },
      update: {
        provider: params.provider,
        bankCode: params.bankCode,
        accountNumber: params.accountNumber,
        accountName: params.accountName,
        providerRecipientId: result.recipientCode,
        verified: true,
      },
    });

    await recordAuditLog(this.prisma, {
      actorId: owner.id,
      action: 'PAYOUT_ACCOUNT_SETUP',
      targetType: 'PayoutAccount',
      targetId: account.id,
      metadata: { provider: params.provider, verified: true },
    });

    return account;
  }

  /** LANDLORD sees only their own payouts; ADMIN sees all, optionally filtered by ?status=. */
  async list(user: AuthUser, statusFilter?: string) {
    if (user.role === UserRole.ADMIN) {
      const where =
        statusFilter && PAYOUT_STATUSES.includes(statusFilter as PayoutStatus)
          ? { status: statusFilter as PayoutStatus }
          : undefined;
      return await this.prisma.payout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { id: true, email: true, name: true } },
          booking: { select: { id: true, listingId: true } },
        },
      });
    }

    if (user.role !== UserRole.LANDLORD) {
      throw new ForbiddenException('not allowed');
    }
    return await this.prisma.payout.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Same ownership rule as list(): the owning landlord or ADMIN. */
  async getOne(user: AuthUser, id: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('payout not found');
    if (user.role !== UserRole.ADMIN && payout.ownerId !== user.id) {
      throw new ForbiddenException('not allowed');
    }
    return payout;
  }

  /**
   * ADMIN only, deliberately not automatic — a human reviews a real money
   * transfer before it fires. Looks up the owner's PayoutAccount (400 if
   * none/not verified), calls the provider's transfer API, and persists
   * PROCESSING -> PAID or PROCESSING -> FAILED depending on the response.
   *
   * The PENDING/FAILED -> PROCESSING transition is a guarded updateMany so
   * a concurrent double-click can't fire the transfer twice; an
   * already-PAID payout is returned as-is (idempotent no-op) rather than
   * re-transferring.
   */
  async process(admin: AuthUser, payoutId: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('payout not found');

    if (payout.status === 'PAID') {
      return payout;
    }
    if (payout.status === 'PROCESSING') {
      throw new BadRequestException('payout is already being processed');
    }

    const account = await this.prisma.payoutAccount.findUnique({
      where: { ownerId: payout.ownerId },
    });
    if (!account || !account.verified) {
      throw new BadRequestException('owner has no verified payout account');
    }

    const claimed = await this.prisma.payout.updateMany({
      where: { id: payoutId, status: { in: ['PENDING', 'FAILED'] } },
      data: { status: 'PROCESSING', provider: account.provider },
    });
    if (claimed.count === 0) {
      throw new BadRequestException('payout is already being processed');
    }

    const result = await this.providers.get(account.provider).transfer({
      reference: payout.reference,
      amount: payout.amount,
      currency: payout.currency,
      recipientCode: account.providerRecipientId ?? undefined,
      accountNumber: account.accountNumber,
      bankCode: account.bankCode,
      narration: `BlueRock payout${payout.bookingId ? ` for booking ${payout.bookingId}` : ''}`,
    });

    const updated = await this.prisma.payout.update({
      where: { id: payoutId },
      data: result.success
        ? {
            status: 'PAID',
            providerTransferId: result.providerTransferId,
            rawPayload: result.raw as Prisma.InputJsonValue,
            paidAt: new Date(),
          }
        : {
            status: 'FAILED',
            rawPayload: result.raw as Prisma.InputJsonValue,
          },
    });

    await recordAuditLog(this.prisma, {
      actorId: admin.id,
      action: 'PAYOUT_PROCESSED',
      targetType: 'Payout',
      targetId: payout.id,
      metadata: {
        provider: account.provider,
        amount: payout.amount,
        currency: payout.currency,
        success: result.success,
      },
    });

    await this.notifications.notify(payout.ownerId, {
      type: NotificationType.PAYOUT_UPDATE,
      title: result.success ? 'Payout sent' : 'Payout failed',
      body: result.success
        ? `Your payout of ${payout.amount} ${payout.currency} has been sent.`
        : `Your payout of ${payout.amount} ${payout.currency} could not be processed. Our team has been notified.`,
      data: { payoutId: payout.id, status: updated.status },
    });

    return updated;
  }
}
