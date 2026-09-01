import type { Prisma, PrismaClient } from '@prisma/client';

export type AuditLogInput = {
  /**
   * Null only for genuinely system-initiated actions (e.g. the booking
   * expiry cron) where no human actor exists to attribute the change to —
   * AuditLog.actorId is a nullable FK precisely for this case, don't
   * substitute a placeholder user id.
   */
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown> | null;
};

/**
 * Records a single moderation/admin action to the AuditLog table. Callers
 * are expected to have already authorized the action; this only persists
 * the trail.
 */
export async function recordAuditLog(
  prisma: PrismaClient,
  input: AuditLogInput,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: (input.metadata ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
    },
  });
}
