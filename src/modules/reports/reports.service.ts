import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ReportStatus, ReportTargetType } from '@prisma/client';

import { recordAuditLog } from '../../common/audit/audit-log';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';

const REPORT_STATUSES: readonly ReportStatus[] = [
  'OPEN',
  'RESOLVED',
  'DISMISSED',
];
const TARGET_TYPES: readonly ReportTargetType[] = ['LISTING', 'USER'];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureAdmin(user: AuthUser) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('admin only');
    }
  }

  async createReport(
    reporter: AuthUser,
    params: {
      targetType: string;
      targetId: string;
      reason: string;
      details?: string | null;
    },
  ) {
    if (!TARGET_TYPES.includes(params.targetType as ReportTargetType)) {
      throw new BadRequestException('targetType must be LISTING or USER');
    }
    const targetType = params.targetType as ReportTargetType;

    const targetId = params.targetId.trim();
    if (!targetId) {
      throw new BadRequestException('targetId is required');
    }

    const reason = params.reason.trim();
    if (!reason) {
      throw new BadRequestException('reason is required');
    }

    if (targetType === 'LISTING') {
      const listing = await this.prisma.listing.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!listing) throw new NotFoundException('listing not found');
    } else {
      const targetUser = await this.prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!targetUser) throw new NotFoundException('user not found');
    }

    return await this.prisma.report.create({
      data: {
        reporterId: reporter.id,
        targetType,
        targetId,
        reason,
        details: params.details?.trim() || null,
        status: 'OPEN',
      },
    });
  }

  async listForAdmin(admin: AuthUser, status?: string) {
    this.ensureAdmin(admin);

    const filterStatus: ReportStatus = REPORT_STATUSES.includes(
      status as ReportStatus,
    )
      ? (status as ReportStatus)
      : 'OPEN';

    return await this.prisma.report.findMany({
      where: { status: filterStatus },
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, email: true, name: true } },
        resolvedBy: { select: { id: true, email: true, name: true } },
      },
    });
  }

  async resolve(
    admin: AuthUser,
    reportId: string,
    decision: 'RESOLVE' | 'DISMISS',
    note?: string | null,
  ) {
    this.ensureAdmin(admin);

    const before = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: { id: true, status: true },
    });
    if (!before) {
      throw new NotFoundException('report not found');
    }

    const status: ReportStatus =
      decision === 'RESOLVE' ? 'RESOLVED' : 'DISMISSED';

    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status,
        resolvedById: admin.id,
        resolvedAt: new Date(),
        resolutionNote: note?.trim() || null,
      },
      include: {
        reporter: { select: { id: true, email: true, name: true } },
        resolvedBy: { select: { id: true, email: true, name: true } },
      },
    });

    await recordAuditLog(this.prisma, {
      actorId: admin.id,
      action: 'REPORT_RESOLUTION',
      targetType: 'Report',
      targetId: reportId,
      metadata: {
        from: before.status,
        to: status,
        decision,
        note: note ?? null,
      },
    });

    return updated;
  }
}
