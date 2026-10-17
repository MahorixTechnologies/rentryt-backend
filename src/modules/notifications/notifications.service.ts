import { BadRequestException, Injectable } from '@nestjs/common';
import type { DevicePlatform, Prisma } from '@prisma/client';

import { EmailService } from '../../common/email/email.service';
import {
  buildOtpEmailHtml,
  buildOtpEmailText,
} from '../../common/email/email-templates';
import { PushService } from '../../common/push/push.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Documented notification type constants. `Notification.type` is a plain
 * string column (not a Prisma enum) so new event sources added later just
 * add a constant here instead of a migration — extend this object, don't
 * fork a parallel one.
 */
export const NotificationType = {
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  PHONE_VERIFICATION: 'PHONE_VERIFICATION',
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

const OTP_TYPES = new Set<string>([
  NotificationType.EMAIL_VERIFICATION,
  NotificationType.PHONE_VERIFICATION,
  NotificationType.PASSWORD_RESET,
]);

const DEVICE_PLATFORMS = new Set<DevicePlatform>(['IOS', 'ANDROID', 'WEB']);

/**
 * Single call site for "alert this user" — writes an in-app Notification
 * row, sends an email (best-effort; EmailService never throws), and fans
 * the same event out over FCM to every registered device token. Every
 * module that needs to tell a user something should call this instead of
 * writing Notification rows or calling EmailService / PushService directly.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly push: PushService,
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

    if (!OTP_TYPES.has(params.type)) {
      await this.dispatchPush(userId, notification.id, params);
    }

    return notification;
  }

  async registerDeviceToken(
    userId: string,
    token: string,
    platform: DevicePlatform,
  ) {
    return await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async unregisterDeviceToken(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({
      where: { userId, token },
    });
    return { success: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { success: true };
  }

  parseDevicePlatform(value: unknown): DevicePlatform {
    if (typeof value !== 'string') {
      throw new BadRequestException("platform must be 'IOS', 'ANDROID', or 'WEB'");
    }
    const platform = value.trim().toUpperCase() as DevicePlatform;
    if (!DEVICE_PLATFORMS.has(platform)) {
      throw new BadRequestException("platform must be 'IOS', 'ANDROID', or 'WEB'");
    }
    return platform;
  }

  parseDeviceToken(value: unknown): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException('token is required');
    }
    return value.trim();
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
      params.type !== NotificationType.PHONE_VERIFICATION &&
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
    const isPhone = params.type === NotificationType.PHONE_VERIFICATION;
    const shared = {
      heading: params.title,
      intro: isReset
        ? "Enter this code to reset your Rentryt password. If you didn't request this, you can ignore this email."
        : isPhone
          ? 'Enter this code to verify the phone number on your Rentryt account.'
          : 'Enter this code to verify your email address and finish setting up your Rentryt account.',
      code,
      expiryMinutes,
    };

    return {
      html: buildOtpEmailHtml(shared),
      text: buildOtpEmailText(shared),
    };
  }

  private async dispatchPush(
    userId: string,
    notificationId: string,
    params: NotifyParams,
  ) {
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (devices.length === 0) return;

    const result = await this.push.send({
      tokens: devices.map((device) => device.token),
      title: params.title,
      body: params.body,
      data: toFcmData({
        type: params.type,
        notificationId,
        ...(params.data ?? {}),
      }),
    });

    if (result.invalidTokens.length > 0) {
      await this.prisma.deviceToken.deleteMany({
        where: { token: { in: result.invalidTokens } },
      });
    }
  }
}

function toFcmData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value == null || key === 'code') continue;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}
