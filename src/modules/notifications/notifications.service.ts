import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { EmailService } from '../../common/email/email.service';
import {
  buildOtpEmailHtml,
  buildOtpEmailText,
} from '../../common/email/email-templates';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Documented notification type constants. `Notification.type` is a plain
 * string column (not a Prisma enum) so new event sources added later just
 * add a constant here instead of a migration — extend this object, don't
 * fork a parallel one.
 */
export const NotificationType = {
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
  BOOKING_STATUS_CHANGE: 'BOOKING_STATUS_CHANGE',
  LISTING_STATUS_CHANGE: 'LISTING_STATUS_CHANGE',
  REVIEW_RECEIVED: 'REVIEW_RECEIVED',
  DISPUTE_UPDATE: 'DISPUTE_UPDATE',
  OWNER_APPLICATION_DECISION: 'OWNER_APPLICATION_DECISION',
  PAYOUT_UPDATE: 'PAYOUT_UPDATE',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  NEW_MESSAGE: 'NEW_MESSAGE',
} as const;
export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

export type NotifyParams = {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
};

/**
 * Single call site for "alert this user" — writes an in-app Notification
 * row and sends an email (best-effort; EmailService never throws) via one
 * call. Every module that needs to tell a user something (auth, bookings,
 * listings, payouts, reviews, disputes, admin decisions) should call this
 * instead of writing Notification rows or calling EmailService directly.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async notify(userId: string, params: NotifyParams) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type: params.type,
        title: params.title,
        body: params.body,
        data: (params.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    if (user?.email) {
      const otp = this.buildOtpEmailParts(params);
      await this.email.send({
        to: user.email,
        subject: params.title,
        html: otp?.html ?? `<p>${params.body}</p>`,
        text: otp?.text ?? params.body,
      });
    }

    return notification;
  }

  /**
   * EMAIL_VERIFICATION and PASSWORD_RESET carry a `data.code`/`data.expiryMinutes`
   * pair (set by AuthService) and get the branded OTP template instead of the
   * generic `<p>${body}</p>` wrapper every other notification type uses.
   */
  private buildOtpEmailParts(
    params: NotifyParams,
  ): { html: string; text: string } | null {
    if (
      params.type !== NotificationType.EMAIL_VERIFICATION &&
      params.type !== NotificationType.PASSWORD_RESET
    ) {
      return null;
    }

    const code = params.data?.code;
    const expiryMinutes = params.data?.expiryMinutes;
    if (typeof code !== 'string' || typeof expiryMinutes !== 'number') {
      return null;
    }

    const isReset = params.type === NotificationType.PASSWORD_RESET;
    const shared = {
      heading: params.title,
      intro: isReset
        ? "Enter this code to reset your BlueRock password. If you didn't request this, you can ignore this email."
        : 'Enter this code to verify your email address and finish setting up your BlueRock account.',
      code,
      expiryMinutes,
    };

    return {
      html: buildOtpEmailHtml(shared),
      text: buildOtpEmailText(shared),
    };
  }
}
