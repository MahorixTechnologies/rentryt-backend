import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DisputeStatus } from '@prisma/client';

import { recordAuditLog } from '../../common/audit/audit-log';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';

const DISPUTE_STATUSES: readonly DisputeStatus[] = [
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED',
  'REJECTED',
];

@Injectable()
export class DisputesService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAdmin(user: AuthUser) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('admin only');
    }
  }

  async raiseDispute(user: AuthUser, bookingId: string, reason: string) {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new BadRequestException('reason is required');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { listing: { select: { ownerId: true } } },
    });
    if (!booking) {
      throw new NotFoundException('booking not found');
    }

    const isRenter = booking.renterId === user.id;
    const isOwningLandlord = booking.listing.ownerId === user.id;
    if (!isRenter && !isOwningLandlord) {
      throw new ForbiddenException(
        'only the renter or the listing owner can raise a dispute for this booking',
      );
    }

    const existingOpen = await this.prisma.dispute.findFirst({
      where: {
        bookingId,
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
      },
      select: { id: true },
    });
    if (existingOpen) {
      throw new BadRequestException('this booking already has an open dispute');
    }

    return await this.prisma.dispute.create({
      data: {
        bookingId,
        raisedById: user.id,
        reason: trimmedReason,
        status: 'OPEN',
      },
    });
  }

  async listForAdmin(admin: AuthUser, status?: string) {
    this.ensureAdmin(admin);

    const filterStatus: DisputeStatus = DISPUTE_STATUSES.includes(
      status as DisputeStatus,
    )
      ? (status as DisputeStatus)
      : 'OPEN';

    return await this.prisma.dispute.findMany({
      where: { status: filterStatus },
      orderBy: { createdAt: 'desc' },
      include: {
        booking: {
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            startDate: true,
            endDate: true,
            total: true,
            listing: {
              select: { id: true, title: true, location: true, ownerId: true },
            },
            renter: { select: { id: true, email: true, name: true } },
          },
        },
        raisedBy: { select: { id: true, email: true, name: true, role: true } },
        decidedBy: { select: { id: true, email: true, name: true } },
      },
    });
  }

  async decide(
    admin: AuthUser,
    disputeId: string,
    status: 'RESOLVED' | 'REJECTED' | 'UNDER_REVIEW',
    resolutionNotes?: string | null,
  ) {
    this.ensureAdmin(admin);

    const before = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      select: { id: true, status: true },
    });
    if (!before) {
      throw new NotFoundException('dispute not found');
    }

    const isFinal = status === 'RESOLVED' || status === 'REJECTED';

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status,
        resolutionNotes: resolutionNotes?.trim() || null,
        decidedById: isFinal ? admin.id : null,
        decidedAt: isFinal ? new Date() : null,
      },
      include: {
        booking: { select: { id: true, listingId: true, renterId: true } },
        raisedBy: { select: { id: true, email: true, name: true } },
      },
    });

    await recordAuditLog(this.prisma, {
      actorId: admin.id,
      action: 'DISPUTE_DECISION',
      targetType: 'Dispute',
      targetId: disputeId,
      metadata: {
        from: before.status,
        to: status,
        resolutionNotes: resolutionNotes ?? null,
      },
    });

    return updated;
  }
}
