import { randomUUID } from 'crypto';

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Currency } from '@prisma/client';

import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import { isListingPublic } from '../../common/listings/listing-visibility';
import { recordAuditLog } from '../../common/audit/audit-log';
import {
  FeeRulesService,
  SERVICE_FEE_PERCENT_DEFAULT,
  SERVICE_FEE_PERCENT_KEY,
} from '../../common/fee-rules/fee-rules.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService, NotificationType } from '../notifications/notifications.service';

function parseDate(value: string): Date {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BadRequestException('dates must be YYYY-MM-DD');
  }
  const [y, m, d] = trimmed.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw new BadRequestException('invalid date');
  }
  return dt;
}

function diffNights(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/** Max stale bookings processed per expiry job run — keeps a repeated hourly run cheap. */
const EXPIRY_BATCH_SIZE = 200;

function formatDateRange(start: Date, end: Date): string {
  return `${start.toISOString().slice(0, 10)} - ${end.toISOString().slice(0, 10)}`;
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeRules: FeeRulesService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertLandlordOwnerOrAdmin(actor: AuthUser, listingOwnerId: string) {
    if (actor.role === UserRole.ADMIN) return;
    if (actor.role === UserRole.LANDLORD && actor.id === listingOwnerId) return;
    throw new ForbiddenException('not allowed');
  }

  async createBooking(
    renter: AuthUser,
    params: { listingId: string; startDate: string; endDate: string },
  ) {
    if (renter.role !== UserRole.RENTER) {
      throw new ForbiddenException('renters only');
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: params.listingId },
    });
    if (!listing || !isListingPublic(listing.status)) {
      throw new NotFoundException('listing not found');
    }

    const start = parseDate(params.startDate);
    const end = parseDate(params.endDate);
    const nights = diffNights(start, end);
    if (nights <= 0) throw new BadRequestException('endDate must be after startDate');

    const overlapping = await this.prisma.booking.findFirst({
      where: {
        listingId: listing.id,
        status: { in: ['PENDING', 'CONFIRMED'] },
        NOT: {
          OR: [{ endDate: { lte: start } }, { startDate: { gte: end } }],
        },
      },
      select: { id: true },
    });
    if (overlapping) {
      throw new BadRequestException('selected dates are not available');
    }

    const serviceFeePercent = await this.feeRules.getPercent(
      SERVICE_FEE_PERCENT_KEY,
      SERVICE_FEE_PERCENT_DEFAULT,
    );

    const subtotal = nights * listing.pricePerNight;
    const serviceFee = Math.round(subtotal * (serviceFeePercent / 100));
    const total = subtotal + serviceFee;

    return await this.prisma.booking.create({
      data: {
        listingId: listing.id,
        renterId: renter.id,
        startDate: start,
        endDate: end,
        nights,
        subtotal,
        serviceFee,
        total,
        status: 'PENDING',
        paymentStatus: 'UNPAID',
      },
      include: {
        listing: { select: { id: true, title: true, location: true, currency: true, pricePerNight: true } },
      },
    });
  }

  async listMyBookings(user: AuthUser) {
    if (user.role !== UserRole.RENTER) {
      throw new ForbiddenException('renters only');
    }
    return await this.prisma.booking.findMany({
      where: { renterId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: { select: { id: true, title: true, location: true, currency: true, pricePerNight: true } },
      },
    });
  }

  async listOwnerBookings(owner: AuthUser) {
    if (owner.role !== UserRole.LANDLORD) {
      throw new ForbiddenException('landlords only');
    }
    return await this.prisma.booking.findMany({
      where: { listing: { ownerId: owner.id } },
      orderBy: { createdAt: 'desc' },
      include: {
        listing: { select: { id: true, title: true, location: true } },
        renter: { select: { id: true, email: true, name: true, phone: true } },
      },
    });
  }

  async decideBooking(owner: AuthUser, bookingId: string, decision: 'ACCEPT' | 'REJECT') {
    if (owner.role !== UserRole.LANDLORD) {
      throw new ForbiddenException('landlords only');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { listing: true },
    });
    if (!booking) throw new NotFoundException('booking not found');
    if (booking.listing.ownerId !== owner.id) {
      throw new ForbiddenException('not allowed');
    }

    const nextStatus = decision === 'ACCEPT' ? 'CONFIRMED' : 'REJECTED';
    return await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: nextStatus },
    });
  }

  /**
   * Manual reconciliation override for admins only (e.g. a confirmed bank
   * transfer outside the normal flow). The renter-facing path is real
   * payment verification via PaymentsService — see markPaidAfterVerifiedPayment.
   */
  async markPaid(admin: AuthUser, bookingId: string) {
    if (admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('admin only');
    }

    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('booking not found');

    return await this.prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: 'PAID', status: booking.status === 'PENDING' ? 'CONFIRMED' : booking.status },
    });
  }

  /**
   * Called only by PaymentsService once a real Paystack/Flutterwave
   * transaction has been independently verified — the caller has already
   * authorized the payer during initiate(), so no auth checks here.
   */
  async markPaidAfterVerifiedPayment(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('booking not found');

    return await this.prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: 'PAID', status: booking.status === 'PENDING' ? 'CONFIRMED' : booking.status },
    });
  }

  /**
   * LANDLORD (owning the listing) or ADMIN marks a guest as arrived.
   * Only valid once CONFIRMED, paid, and the stay's startDate has arrived.
   */
  async checkIn(actor: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { listing: { select: { ownerId: true, title: true } } },
    });
    if (!booking) throw new NotFoundException('booking not found');
    this.assertLandlordOwnerOrAdmin(actor, booking.listing.ownerId);

    if (booking.status !== 'CONFIRMED') {
      throw new BadRequestException('booking must be CONFIRMED before check-in');
    }
    if (booking.paymentStatus !== 'PAID') {
      throw new BadRequestException('booking must be paid before check-in');
    }
    if (new Date() < booking.startDate) {
      throw new BadRequestException('cannot check in before the booking start date');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'CHECKED_IN' },
    });

    await recordAuditLog(this.prisma, {
      actorId: actor.id,
      action: 'BOOKING_CHECKED_IN',
      targetType: 'Booking',
      targetId: bookingId,
      metadata: { from: 'CONFIRMED', to: 'CHECKED_IN' },
    });

    await this.notifications.notify(booking.renterId, {
      type: NotificationType.BOOKING_STATUS_CHANGE,
      title: 'You have checked in',
      body: `You have been checked in to ${booking.listing.title}. Enjoy your stay!`,
      data: { bookingId, status: 'CHECKED_IN' },
    });

    return updated;
  }

  /**
   * LANDLORD (owning the listing) or ADMIN marks a guest as departed.
   * Collapses CHECKED_OUT straight into COMPLETED — see report notes:
   * nothing downstream needs to distinguish "just checked out" from
   * "fully completed", and COMPLETED is the single status that means
   * "safe to pay the owner out". The CHECKED_OUT enum value exists in the
   * schema for future use but is intentionally never assigned today.
   */
  async checkOut(actor: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { listing: { select: { ownerId: true, title: true, currency: true } } },
    });
    if (!booking) throw new NotFoundException('booking not found');
    this.assertLandlordOwnerOrAdmin(actor, booking.listing.ownerId);

    if (booking.status !== 'CHECKED_IN') {
      throw new BadRequestException('booking must be CHECKED_IN before check-out');
    }

    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'COMPLETED' },
    });

    await recordAuditLog(this.prisma, {
      actorId: actor.id,
      action: 'BOOKING_CHECKED_OUT',
      targetType: 'Booking',
      targetId: bookingId,
      metadata: { from: 'CHECKED_IN', to: 'COMPLETED' },
    });

    await this.notifications.notify(booking.renterId, {
      type: NotificationType.BOOKING_STATUS_CHANGE,
      title: 'Your stay is complete',
      body: `Your stay at ${booking.listing.title} is complete. Thanks for booking with us!`,
      data: { bookingId, status: 'COMPLETED' },
    });

    // COMPLETED + PAID is the single signal that means "safe to pay the
    // owner out" (see checkOut's own doc comment above). Auto-creates a
    // PENDING Payout here rather than via PayoutsService to avoid a
    // circular module dependency (a PayoutsModule import of BookingsModule
    // would need to be mirrored by BookingsModule importing PayoutsModule).
    // The real provider transfer only fires later, via the admin-only
    // POST /admin/payouts/:id/process.
    if (booking.paymentStatus === 'PAID') {
      await this.createPendingPayout(booking.id, booking.listing.ownerId, {
        subtotal: booking.subtotal,
        serviceFee: booking.serviceFee,
        currency: booking.listing.currency,
      });
    }

    return updated;
  }

  /**
   * amount = booking.subtotal - booking.serviceFee — the booking's own
   * immutable, already-snapshotted fee fields, not re-derived from
   * FeeRulesService (whose live value may have changed since the booking
   * was created).
   *
   * `provider` defaults to the owner's already-configured PayoutAccount
   * provider if one exists, else PAYSTACK as a placeholder — neither value
   * drives real money movement: POST /admin/payouts/:id/process re-reads
   * the owner's PayoutAccount at transfer time and corrects `provider` to
   * match, so a default guessed wrong here (or a provider the owner later
   * changes) never causes a transfer via the wrong adapter.
   */
  private async createPendingPayout(
    bookingId: string,
    ownerId: string,
    fees: { subtotal: number; serviceFee: number; currency: Currency },
  ) {
    const account = await this.prisma.payoutAccount.findUnique({ where: { ownerId } });

    await this.prisma.payout.create({
      data: {
        ownerId,
        bookingId,
        amount: fees.subtotal - fees.serviceFee,
        currency: fees.currency,
        status: 'PENDING',
        provider: account?.provider ?? 'PAYSTACK',
        reference: `payout_${randomUUID()}`,
      },
    });
  }

  /**
   * The renter who owns the booking, the LANDLORD who owns the listing, or
   * ADMIN may cancel — but only while PENDING or CONFIRMED (not once the
   * guest has checked in). If the booking was already PAID, no real refund
   * is issued here — that lands in the next stage of this build. Instead
   * paymentStatus is flipped PAID -> REFUND_PENDING (a new enum value)
   * precisely so the next stage can cheaply find "cancelled bookings that
   * still owe a refund" via `where: { paymentStatus: 'REFUND_PENDING' }`
   * without re-deriving it from status + audit-log metadata.
   */
  async cancel(actor: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { listing: { select: { ownerId: true, title: true } } },
    });
    if (!booking) throw new NotFoundException('booking not found');

    const isRenter = actor.id === booking.renterId;
    const isOwningLandlord = actor.role === UserRole.LANDLORD && actor.id === booking.listing.ownerId;
    const isAdmin = actor.role === UserRole.ADMIN;
    if (!isRenter && !isOwningLandlord && !isAdmin) {
      throw new ForbiddenException('not allowed');
    }

    if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
      throw new BadRequestException('booking can only be cancelled while PENDING or CONFIRMED');
    }

    const refundOwed = booking.paymentStatus === 'PAID';
    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        paymentStatus: refundOwed ? 'REFUND_PENDING' : booking.paymentStatus,
      },
    });

    await recordAuditLog(this.prisma, {
      actorId: actor.id,
      action: 'BOOKING_CANCELLED',
      targetType: 'Booking',
      targetId: bookingId,
      metadata: { from: booking.status, to: 'CANCELLED', refundOwed },
    });

    const body = `Booking for ${booking.listing.title} (${formatDateRange(booking.startDate, booking.endDate)}) has been cancelled.`;
    await Promise.all([
      this.notifications.notify(booking.renterId, {
        type: NotificationType.BOOKING_STATUS_CHANGE,
        title: 'Booking cancelled',
        body,
        data: { bookingId, status: 'CANCELLED', refundOwed },
      }),
      this.notifications.notify(booking.listing.ownerId, {
        type: NotificationType.BOOKING_STATUS_CHANGE,
        title: 'Booking cancelled',
        body,
        data: { bookingId, status: 'CANCELLED', refundOwed },
      }),
    ]);

    return updated;
  }

  /**
   * Scheduled (hourly) sweep — see BookingsExpiryJob. Finds PENDING
   * bookings whose startDate has already passed without ever being
   * confirmed, and auto-cancels them with the same audit-log + payment
   * signalling + notification treatment as an explicit cancel. Uses the
   * (status, startDate) index so the query stays cheap on every run.
   *
   * Each row is flipped with a conditional `updateMany` guarded on
   * `status: 'PENDING'` so a booking confirmed/cancelled concurrently
   * between the read and the write is never double-processed.
   *
   * There is no human actor for an automated action, so the audit-log
   * entry is written with actorId: null (AuditLog.actorId is nullable for
   * exactly this case) rather than attributing it to a placeholder user.
   */
  async expireStalePendingBookings(): Promise<number> {
    const now = new Date();
    const stale = await this.prisma.booking.findMany({
      where: { status: 'PENDING', startDate: { lt: now } },
      select: {
        id: true,
        renterId: true,
        paymentStatus: true,
        startDate: true,
        endDate: true,
        listing: { select: { ownerId: true, title: true } },
      },
      take: EXPIRY_BATCH_SIZE,
    });

    let expiredCount = 0;
    for (const booking of stale) {
      const refundOwed = booking.paymentStatus === 'PAID';

      // Conditional write: only succeeds if still PENDING, so a concurrent
      // confirm/cancel of the same booking is never clobbered.
      const result = await this.prisma.booking.updateMany({
        where: { id: booking.id, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          paymentStatus: refundOwed ? 'REFUND_PENDING' : booking.paymentStatus,
        },
      });
      if (result.count === 0) continue;
      expiredCount += 1;

      await recordAuditLog(this.prisma, {
        actorId: null,
        action: 'BOOKING_CANCELLED',
        targetType: 'Booking',
        targetId: booking.id,
        metadata: {
          from: 'PENDING',
          to: 'CANCELLED',
          refundOwed,
          automated: true,
          reason: 'startDate passed while booking was still PENDING (booking expiry job)',
        },
      });

      const body = `Booking for ${booking.listing.title} (${formatDateRange(booking.startDate, booking.endDate)}) was automatically cancelled because it was never confirmed before the start date.`;
      await Promise.all([
        this.notifications.notify(booking.renterId, {
          type: NotificationType.BOOKING_STATUS_CHANGE,
          title: 'Booking cancelled (expired)',
          body,
          data: { bookingId: booking.id, status: 'CANCELLED', refundOwed, automated: true },
        }),
        this.notifications.notify(booking.listing.ownerId, {
          type: NotificationType.BOOKING_STATUS_CHANGE,
          title: 'Booking cancelled (expired)',
          body,
          data: { bookingId: booking.id, status: 'CANCELLED', refundOwed, automated: true },
        }),
      ]);
    }

    if (expiredCount > 0) {
      this.logger.log(`Auto-cancelled ${expiredCount} stale PENDING booking(s) past their start date`);
    }

    return expiredCount;
  }
}
