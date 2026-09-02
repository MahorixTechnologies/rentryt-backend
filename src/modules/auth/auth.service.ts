import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import type { StringValue } from 'ms';

import { UserRole } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotificationsService,
  NotificationType,
} from '../notifications/notifications.service';

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

const WEAK_PASSWORDS = new Set([
  'password',
  'password123',
  '123456',
  '12345678',
  'qwerty',
  'qwerty123',
  'abc123',
  'letmein',
  'welcome',
  'admin',
  'admin123',
  'iloveyou',
  'monkey',
  'dragon',
  'master',
  'bluerock',
  'bluerock123',
]);

function requirePassword(password: unknown) {
  if (typeof password !== 'string') {
    throw new BadRequestException('password must be at least 8 characters');
  }
  const value = password;
  if (value.length < 8) {
    throw new BadRequestException('password must be at least 8 characters');
  }
  if (value.length > 128) {
    throw new BadRequestException('password is too long');
  }
  if (WEAK_PASSWORDS.has(value.toLowerCase())) {
    throw new BadRequestException('choose a stronger password');
  }
  return value;
}

const EMAIL_VERIFY_TTL_MINUTES = 15;
const PASSWORD_RESET_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

function makeOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Response fields carrying a raw verification/reset code exist only for
 * local dev and the demo frontends (which read the code straight off the
 * response when no email server is wired up) — production must never leak
 * a code that should only ever reach the user's inbox, so this is the one
 * gate that decides whether register()/requestEmailVerification()/
 * forgotPassword() echo it back at all. The email (or console-log fallback
 * in dev) is sent unconditionally, in every environment, via
 * NotificationsService.
 */
function includeRawTokenInResponse(): boolean {
  return process.env.NODE_ENV !== 'production';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  async register(params: {
    email: string;
    password: string;
    role?: UserRole;
    phone?: string;
    name?: string;
  }) {
    const email = normalizeEmail(params.email);
    const password = requirePassword(params.password);
    let role = params.role ?? UserRole.RENTER;
    if (role === UserRole.ADMIN) {
      role = UserRole.RENTER;
    }

    if (
      role === UserRole.LANDLORD &&
      (!params.phone || params.phone.trim().length === 0)
    ) {
      throw new BadRequestException('phone is required for landlords');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        phone: params.phone?.trim() || null,
        name: params.name?.trim() || null,
      },
      select: {
        id: true,
        email: true,
        role: true,
        emailVerified: true,
        name: true,
        phone: true,
      },
    });

    const code = await this.issueOtp(
      user.id,
      'EMAIL_VERIFY',
      EMAIL_VERIFY_TTL_MINUTES,
    );

    await this.notifications.notify(user.id, {
      type: NotificationType.EMAIL_VERIFICATION,
      title: 'Verify your email',
      body: `Your BlueRock verification code is ${code}. It expires in ${EMAIL_VERIFY_TTL_MINUTES} minutes.`,
      data: { code, expiryMinutes: EMAIL_VERIFY_TTL_MINUTES },
    });

    const accessToken = await this.signToken(user.id, user.email, user.role);

    return {
      accessToken,
      user,
      ...(includeRawTokenInResponse() ? { emailVerificationCode: code } : {}),
    };
  }

  async login(params: { email: string; password: string }) {
    const email = normalizeEmail(params.email);
    const password = params.password;
    if (typeof password !== 'string' || password.length === 0) {
      throw new UnauthorizedException('invalid credentials');
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        name: true,
        phone: true,
        passwordHash: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('invalid credentials');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('invalid credentials');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('invalid credentials');
    }

    const accessToken = await this.signToken(user.id, user.email, user.role);
    const { passwordHash, ...safeUser } = user;
    return { accessToken, user: safeUser };
  }

  async requestEmailVerification(emailInput: string) {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return { success: true };

    const code = await this.issueOtp(
      user.id,
      'EMAIL_VERIFY',
      EMAIL_VERIFY_TTL_MINUTES,
    );

    await this.notifications.notify(user.id, {
      type: NotificationType.EMAIL_VERIFICATION,
      title: 'Verify your email',
      body: `Your BlueRock verification code is ${code}. It expires in ${EMAIL_VERIFY_TTL_MINUTES} minutes.`,
      data: { code, expiryMinutes: EMAIL_VERIFY_TTL_MINUTES },
    });

    return {
      success: true,
      ...(includeRawTokenInResponse() ? { emailVerificationCode: code } : {}),
    };
  }

  async verifyEmail(params: { email: string; code: string }) {
    const email = normalizeEmail(params.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('invalid or expired code');
    }

    const record = await this.consumeOtp(user.id, 'EMAIL_VERIFY', params.code);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      }),
      this.prisma.token.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  async forgotPassword(emailInput: string) {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return { success: true };

    const code = await this.issueOtp(
      user.id,
      'PASSWORD_RESET',
      PASSWORD_RESET_TTL_MINUTES,
    );

    await this.notifications.notify(user.id, {
      type: NotificationType.PASSWORD_RESET,
      title: 'Reset your password',
      body: `Your BlueRock password reset code is ${code}. It expires in ${PASSWORD_RESET_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.`,
      data: { code, expiryMinutes: PASSWORD_RESET_TTL_MINUTES },
    });

    return {
      success: true,
      ...(includeRawTokenInResponse() ? { passwordResetCode: code } : {}),
    };
  }

  async resetPassword(params: {
    email: string;
    code: string;
    newPassword: string;
  }) {
    const password = requirePassword(params.newPassword);
    const email = normalizeEmail(params.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) {
      throw new BadRequestException('invalid or expired code');
    }

    const record = await this.consumeOtp(
      user.id,
      'PASSWORD_RESET',
      params.code,
    );

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.token.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  /**
   * Generates a fresh 6-digit OTP for (userId, type), invalidating any
   * previously-issued unused code of the same type first so only the latest
   * one is ever valid (and attempt counts reset with each new code).
   */
  private async issueOtp(
    userId: string,
    type: 'EMAIL_VERIFY' | 'PASSWORD_RESET',
    ttlMinutes: number,
  ): Promise<string> {
    await this.prisma.token.updateMany({
      where: { userId, type, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = makeOtp();
    await this.prisma.token.create({
      data: {
        userId,
        type,
        token: code,
        expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
      },
    });
    return code;
  }

  /**
   * Looks up the latest unused OTP of `type` for `userId` and validates
   * `code` against it — expired/mismatched/too-many-attempts all raise a
   * single generic "invalid or expired code" error so nothing about which
   * failure mode occurred leaks to the client. A wrong guess increments
   * `attempts`; after MAX_OTP_ATTEMPTS the code is burned outright, forcing
   * the user to request a new one instead of continuing to guess.
   */
  private async consumeOtp(
    userId: string,
    type: 'EMAIL_VERIFY' | 'PASSWORD_RESET',
    code: string,
  ) {
    const record = await this.prisma.token.findFirst({
      where: { userId, type, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const invalid = () => new BadRequestException('invalid or expired code');

    if (!record) {
      throw invalid();
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw invalid();
    }
    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await this.prisma.token.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      throw invalid();
    }
    if (record.token !== code.trim()) {
      await this.prisma.token.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid();
    }

    return record;
  }

  private async signToken(userId: string, email: string, role: UserRole) {
    const expiresIn = this.config.get<string>(
      'JWT_EXPIRES_IN',
      '7d',
    ) as StringValue;
    return await this.jwt.signAsync(
      { sub: userId, email, role },
      { expiresIn },
    );
  }
}
