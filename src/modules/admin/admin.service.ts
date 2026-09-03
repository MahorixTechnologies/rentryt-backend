import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BookingStatus,
  ListingStatus,
  OwnerApplicationStatus,
  PaymentTxStatus,
  Prisma,
  ReviewModerationStatus,
  UserRole as PrismaUserRole,
  UserStatus,
} from '@prisma/client';

import { recordAuditLog } from '../../common/audit/audit-log';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PaymentsService } from '../payments/payments.service';
import { PayoutsService } from '../payouts/payouts.service';

const TRENDS_WEEKS = 12;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Returns the UTC Monday 00:00:00 that begins the week containing `date`. */
function startOfWeekUTC(date: Date): Date {
  const day = date.getUTCDay(); // 0 = Sunday ... 6 = Saturday
  const offsetFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - offsetFromMonday);
  return monday;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const OWNER_APPLICATION_STATUSES: readonly OwnerApplicationStatus[] = [
  'NONE',
  'PENDING',
  'APPROVED',
  'REJECTED',
];

const USER_ROLES: readonly PrismaUserRole[] = ['RENTER', 'LANDLORD', 'ADMIN'];
const USER_STATUSES: readonly UserStatus[] = ['ACTIVE', 'SUSPENDED'];
const LISTING_STATUSES: readonly ListingStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'ARCHIVED',
];
const BOOKING_STATUSES: readonly BookingStatus[] = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
];
const PAYMENT_TX_STATUSES: readonly PaymentTxStatus[] = [
  'INITIATED',
  'SUCCESSFUL',
  'FAILED',
  'REFUNDED',
];
const REVIEW_MODERATION_STATUSES: readonly ReviewModerationStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
];

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Parses `?page=`/`?pageSize=` into a safe skip/take pair, clamping pageSize. */
function parsePagination(pageParam?: string, pageSizeParam?: string) {
  const pageParsed = pageParam != null ? Number(pageParam) : NaN;
  const page =
    Number.isFinite(pageParsed) && pageParsed > 0 ? Math.trunc(pageParsed) : 1;

  const sizeParsed = pageSizeParam != null ? Number(pageSizeParam) : NaN;
  const pageSize =
    Number.isFinite(sizeParsed) && sizeParsed > 0
      ? Math.min(Math.trunc(sizeParsed), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function enumOrUndefined<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value != null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly conversations: ConversationsService,
  ) {}

  private ensureAdmin(user: AuthUser) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('admin only');
    }
  }

  async stats(user: AuthUser) {
    this.ensureAdmin(user);
    const [users, listings, bookings, revenue] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.listing.count(),
      this.prisma.booking.count(),
      this.prisma.booking.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { total: true },
      }),
    ]);

    return {
      users,
      listings,
      bookings,
      revenue: revenue._sum.total ?? 0,
    };
  }

  async users(
    user: AuthUser,
    params: {
      role?: string;
      status?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    } = {},
  ) {
    this.ensureAdmin(user);

    const role = enumOrUndefined(params.role, USER_ROLES);
    const status = enumOrUndefined(params.status, USER_STATUSES);
    const search = params.search?.trim();
    const { page, pageSize, skip, take } = parsePagination(
      params.page,
      params.pageSize,
    );

    const where: Prisma.UserWhereInput = {
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const select = {
      id: true,
      email: true,
      role: true,
      status: true,
      emailVerified: true,
      name: true,
      phone: true,
      createdAt: true,
    } as const;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async user(user: AuthUser, userId: string) {
    this.ensureAdmin(user);

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        name: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            listings: true,
            bookings: true,
            reviews: true,
            tokens: true,
          },
        },
        listings: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            title: true,
            location: true,
            status: true,
            createdAt: true,
            pricePerNight: true,
            currency: true,
          },
        },
        bookings: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            createdAt: true,
            total: true,
            status: true,
            paymentStatus: true,
            listing: {
              select: {
                id: true,
                title: true,
                location: true,
              },
            },
          },
        },
      },
    });

    if (!target) {
      throw new NotFoundException('user not found');
    }

    const { listings, bookings, _count, ...rest } = target;

    return {
      ...rest,
      counts: {
        listingsOwned: _count.listings,
        bookingsAsRenter: _count.bookings,
        reviewsWritten: _count.reviews,
        accessTokens: _count.tokens,
      },
      recentListings: listings,
      recentBookings: bookings,
    };
  }

  async listings(
    user: AuthUser,
    params: {
      status?: string;
      ownerId?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    } = {},
  ) {
    this.ensureAdmin(user);

    const status = enumOrUndefined(params.status, LISTING_STATUSES);
    const search = params.search?.trim();
    const { page, pageSize, skip, take } = parsePagination(
      params.page,
      params.pageSize,
    );

    const where: Prisma.ListingWhereInput = {
      ...(status ? { status } : {}),
      ...(params.ownerId ? { ownerId: params.ownerId } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { location: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          owner: { select: { id: true, email: true, name: true, phone: true } },
        },
      }),
      this.prisma.listing.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async listing(user: AuthUser, id: string) {
    this.ensureAdmin(user);
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, email: true, name: true, phone: true } },
      },
    });
    if (!listing) throw new NotFoundException('listing not found');
    return listing;
  }

  async bookings(
    user: AuthUser,
    params: {
      status?: string;
      paymentStatus?: string;
      renterId?: string;
      listingId?: string;
      page?: string;
      pageSize?: string;
    } = {},
  ) {
    this.ensureAdmin(user);

    const status = enumOrUndefined(params.status, BOOKING_STATUSES);
    const paymentStatus = enumOrUndefined(params.paymentStatus, [
      'UNPAID',
      'PAID',
      'REFUND_PENDING',
      'REFUNDED',
    ] as const);
    const { page, pageSize, skip, take } = parsePagination(
      params.page,
      params.pageSize,
    );

    const where: Prisma.BookingWhereInput = {
      ...(status ? { status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(params.renterId ? { renterId: params.renterId } : {}),
      ...(params.listingId ? { listingId: params.listingId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          listing: {
            select: { id: true, title: true, location: true, ownerId: true },
          },
          renter: {
            select: { id: true, email: true, name: true, phone: true },
          },
        },
      }),
      this.prisma.booking.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async booking(user: AuthUser, id: string) {
    this.ensureAdmin(user);
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        listing: {
          select: { id: true, title: true, location: true, ownerId: true },
        },
        renter: { select: { id: true, email: true, name: true, phone: true } },
        payments: true,
        payouts: true,
      },
    });
    if (!booking) throw new NotFoundException('booking not found');
    return booking;
  }

  async setUserStatus(
    user: AuthUser,
    userId: string,
    status: 'ACTIVE' | 'SUSPENDED',
  ) {
    this.ensureAdmin(user);

    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
    if (!before) {
      throw new NotFoundException('user not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: { id: true, email: true, status: true },
    });

    await recordAuditLog(this.prisma, {
      actorId: user.id,
      action: 'USER_STATUS_CHANGE',
      targetType: 'User',
      targetId: userId,
      metadata: { from: before.status, to: status },
    });

    return updated;
  }

  async ownerApplications(user: AuthUser, status?: string) {
    this.ensureAdmin(user);

    const filterStatus: OwnerApplicationStatus =
      OWNER_APPLICATION_STATUSES.includes(status as OwnerApplicationStatus)
        ? (status as OwnerApplicationStatus)
        : 'PENDING';

    return await this.prisma.user.findMany({
      where: { ownerApplicationStatus: filterStatus },
      orderBy: { ownerApplicationAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        ownerApplicationStatus: true,
        ownerApplicationAt: true,
        createdAt: true,
      },
    });
  }

  async decideOwnerApplication(
    admin: AuthUser,
    userId: string,
    decision: 'APPROVE' | 'REJECT',
  ) {
    this.ensureAdmin(admin);

    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, ownerApplicationStatus: true },
    });
    if (!target) {
      throw new NotFoundException('user not found');
    }
    if (target.ownerApplicationStatus !== 'PENDING') {
      throw new BadRequestException(
        'user does not have a pending owner application',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data:
        decision === 'APPROVE'
          ? { role: UserRole.LANDLORD, ownerApplicationStatus: 'APPROVED' }
          : { ownerApplicationStatus: 'REJECTED' },
      select: {
        id: true,
        email: true,
        role: true,
        ownerApplicationStatus: true,
        ownerApplicationAt: true,
      },
    });

    await recordAuditLog(this.prisma, {
      actorId: admin.id,
      action: 'OWNER_APPLICATION_DECISION',
      targetType: 'User',
      targetId: userId,
      metadata: {
        decision,
        fromRole: target.role,
        toRole: updated.role,
      },
    });

    return updated;
  }

  async moderateReview(
    admin: AuthUser,
    reviewId: string,
    status: 'APPROVED' | 'REJECTED',
  ) {
    this.ensureAdmin(admin);

    const before = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true, moderationStatus: true },
    });
    if (!before) {
      throw new NotFoundException('review not found');
    }

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { moderationStatus: status },
    });

    await recordAuditLog(this.prisma, {
      actorId: admin.id,
      action: 'REVIEW_MODERATION',
      targetType: 'Review',
      targetId: reviewId,
      metadata: { from: before.moderationStatus, to: status },
    });

    return updated;
  }

  async auditLogs(
    user: AuthUser,
    params: {
      action?: string;
      targetType?: string;
      actorId?: string;
      page?: string;
      pageSize?: string;
    } = {},
  ) {
    this.ensureAdmin(user);

    const { page, pageSize, skip, take } = parsePagination(
      params.page,
      params.pageSize,
    );

    const where: Prisma.AuditLogWhereInput = {
      ...(params.action ? { action: params.action } : {}),
      ...(params.targetType ? { targetType: params.targetType } : {}),
      ...(params.actorId ? { actorId: params.actorId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          actor: { select: { id: true, email: true, name: true, role: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async feeRules(user: AuthUser) {
    this.ensureAdmin(user);
    return await this.prisma.feeRule.findMany({ orderBy: { key: 'asc' } });
  }

  async updateFeeRule(admin: AuthUser, key: string, value: number) {
    this.ensureAdmin(admin);

    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    ) {
      throw new BadRequestException('value must be a number between 0 and 100');
    }

    const before = await this.prisma.feeRule.findUnique({ where: { key } });
    if (!before) {
      throw new NotFoundException('fee rule not found');
    }

    const updated = await this.prisma.feeRule.update({
      where: { key },
      data: { value, updatedById: admin.id },
    });

    await recordAuditLog(this.prisma, {
      actorId: admin.id,
      action: 'FEE_RULE_UPDATE',
      targetType: 'FeeRule',
      targetId: updated.id,
      metadata: { key, from: before.value, to: value },
    });

    return updated;
  }

  /**
   * Manual refund trigger (e.g. a dispute resolution needing intervention
   * outside the automatic cancelled-booking sweep). Delegates entirely to
   * PaymentsService.refund — the same method RefundsProcessorJob calls for
   * automatic refunds — which does the real provider call, the guarded
   * status flip, the audit log, and the payer notification. No duplicate
   * audit-log call here: PaymentsService.refund already records
   * PAYMENT_REFUNDED with this admin's actorId.
   */
  async refundPayment(admin: AuthUser, paymentId: string) {
    this.ensureAdmin(admin);
    return await this.payments.refund({ paymentId, actorId: admin.id });
  }

  /**
   * Manual, admin-only trigger for a real owner payout — see
   * PayoutsService.process for the provider transfer call, the
   * PENDING/FAILED -> PROCESSING -> PAID/FAILED transition, the audit log,
   * and the owner notification.
   */
  async processPayout(admin: AuthUser, payoutId: string) {
    this.ensureAdmin(admin);
    return await this.payouts.process(admin, payoutId);
  }

  /**
   * Weekly booking counts + revenue for roughly the last TRENDS_WEEKS weeks,
   * plus a breakdown of current booking counts by status. See report for
   * exact response shape.
   */
  async analyticsTrends(user: AuthUser) {
    this.ensureAdmin(user);

    const currentWeekStart = startOfWeekUTC(new Date());
    const earliestWeekStart = new Date(
      currentWeekStart.getTime() - (TRENDS_WEEKS - 1) * MS_PER_WEEK,
    );

    const [recentBookings, statusGroups] = await Promise.all([
      this.prisma.booking.findMany({
        where: { createdAt: { gte: earliestWeekStart } },
        select: { createdAt: true, total: true },
      }),
      this.prisma.booking.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const buckets = new Map<
      string,
      { weekStart: string; count: number; revenue: number }
    >();
    for (let i = 0; i < TRENDS_WEEKS; i++) {
      const weekStart = new Date(earliestWeekStart.getTime() + i * MS_PER_WEEK);
      const key = toIsoDate(weekStart);
      buckets.set(key, { weekStart: key, count: 0, revenue: 0 });
    }

    for (const booking of recentBookings) {
      const key = toIsoDate(startOfWeekUTC(booking.createdAt));
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count += 1;
        bucket.revenue += booking.total;
      }
    }

    const series = Array.from(buckets.values());
    const statusBreakdown = statusGroups.map((group) => ({
      status: group.status,
      count: group._count._all,
    }));

    return { series, statusBreakdown };
  }

  /**
   * Read-only support visibility into a conversation — see
   * ConversationsService.getMessagesForAdmin. Deliberately no admin write
   * path exists anywhere under /admin/conversations.
   */
  async conversationMessages(user: AuthUser, conversationId: string) {
    this.ensureAdmin(user);
    return await this.conversations.getMessagesForAdmin(conversationId);
  }

  /** All payment transaction records platform-wide, filterable and paginated. */
  async listPayments(
    user: AuthUser,
    params: {
      status?: string;
      purpose?: string;
      payerId?: string;
      search?: string;
      page?: string;
      pageSize?: string;
    } = {},
  ) {
    this.ensureAdmin(user);

    const status = enumOrUndefined(params.status, PAYMENT_TX_STATUSES);
    const purpose = enumOrUndefined(params.purpose, [
      'BOOKING',
      'FEATURED_LISTING',
    ] as const);
    const search = params.search?.trim();
    const { page, pageSize, skip, take } = parsePagination(
      params.page,
      params.pageSize,
    );

    const where: Prisma.PaymentWhereInput = {
      ...(status ? { status } : {}),
      ...(purpose ? { purpose } : {}),
      ...(params.payerId ? { payerId: params.payerId } : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' } },
              {
                providerTransactionId: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          payer: { select: { id: true, email: true, name: true } },
          booking: { select: { id: true, listingId: true } },
          listing: { select: { id: true, title: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async getPayment(user: AuthUser, id: string) {
    this.ensureAdmin(user);
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        payer: { select: { id: true, email: true, name: true, phone: true } },
        booking: true,
        listing: { select: { id: true, title: true, location: true } },
      },
    });
    if (!payment) throw new NotFoundException('payment not found');
    return payment;
  }

  /** All reviews platform-wide (defaults to PENDING moderation queue). */
  async reviews(
    user: AuthUser,
    params: { status?: string; page?: string; pageSize?: string } = {},
  ) {
    this.ensureAdmin(user);

    const status = enumOrUndefined(params.status, REVIEW_MODERATION_STATUSES);
    const { page, pageSize, skip, take } = parsePagination(
      params.page,
      params.pageSize,
    );

    const where: Prisma.ReviewWhereInput = status
      ? { moderationStatus: status }
      : {};

    const [data, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          renter: { select: { id: true, name: true, email: true } },
          listing: { select: { id: true, title: true, ownerId: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /** All conversations platform-wide — support/discovery visibility only. */
  async conversationsList(
    user: AuthUser,
    params: { page?: string; pageSize?: string } = {},
  ) {
    this.ensureAdmin(user);
    const { page, pageSize, skip, take } = parsePagination(
      params.page,
      params.pageSize,
    );

    const [data, total] = await Promise.all([
      this.prisma.conversation.findMany({
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
        include: {
          renter: { select: { id: true, name: true, email: true } },
          owner: { select: { id: true, name: true, email: true } },
          listing: { select: { id: true, title: true } },
          booking: { select: { id: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { messages: true } },
        },
      }),
      this.prisma.conversation.count(),
    ]);

    return {
      data: data.map(({ messages, ...rest }) => ({
        ...rest,
        latestMessage: messages[0] ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }
}
