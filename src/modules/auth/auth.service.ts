import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import type { StringValue } from 'ms';

import { EmailService } from '../../common/email/email.service';
import { buildOtpEmailHtml, buildOtpEmailText } from '../../common/email/email-templates';
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
  'rentryt',
  'rentryt123',
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
    private readonly email: EmailService,
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

    // Web's signup flow verifies the email BEFORE this call (see
    // sendSignupCode/verifySignupCode) and only reaches register() once a
    // SignupVerification row for this email has been confirmed (usedAt set)
    // and not yet spent (consumedAt null) — in that case the account is
    // created already-verified and signed in immediately, mirroring
    // login()'s response shape. Mobile has no such pre-step, so it always
    // falls through to the legacy path below: an unverified account that
    // must complete the post-registration verifyEmail() flow before it can
    // log in at all.
    const verification = await this.prisma.signupVerification.findFirst({
      where: { email, usedAt: { not: null }, consumedAt: null },
      orderBy: { usedAt: 'desc' },
    });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        role,
        phone: params.phone?.trim() || null,
        name: params.name?.trim() || null,
        emailVerified: Boolean(verification),
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

    if (verification) {
      await this.prisma.signupVerification.update({
        where: { id: verification.id },
        data: { consumedAt: new Date() },
      });
      const accessToken = await this.signToken(user.id, user.email, user.role);
      return { accessToken, user };
    }

    const code = await this.issueOtp(
      user.id,
      'EMAIL_VERIFY',
      EMAIL_VERIFY_TTL_MINUTES,
    );

    await this.notifications.notify(user.id, {
      type: NotificationType.EMAIL_VERIFICATION,
      title: 'Verify your email',
      body: `Your Rentryt verification code is ${code}. It expires in ${EMAIL_VERIFY_TTL_MINUTES} minutes.`,
      data: { code, expiryMinutes: EMAIL_VERIFY_TTL_MINUTES },
    });

    // No accessToken here, deliberately — a registration is not a session
    // until the email is verified (see verifyEmail(), which is the only
    // place a fresh account is signed in). login() also refuses unverified
    // accounts, so an unverified user has zero API access either way.
    return {
      user,
      ...(includeRawTokenInResponse() ? { emailVerificationCode: code } : {}),
    };
  }

  /**
   * Step 1 of web's "verify email, then set a password" signup order —
   * proves ownership of an email address before any User row exists.
   * Independent of Token/TokenType (which always requires a userId).
   */
  async sendSignupCode(emailInput: string) {
    const email = normalizeEmail(emailInput);
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('email already registered');
    }

    await this.prisma.signupVerification.deleteMany({
      where: { email, consumedAt: null },
    });

    const code = makeOtp();
    await this.prisma.signupVerification.create({
      data: {
        email,
        token: code,
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MINUTES * 60 * 1000),
      },
    });

    await this.email.send({
      to: email,
      subject: 'Verify your email',
      html: buildOtpEmailHtml({
        heading: 'Verify your email',
        intro:
          'Enter this code to verify your email address and continue creating your Rentryt account.',
        code,
        expiryMinutes: EMAIL_VERIFY_TTL_MINUTES,
      }),
      text: buildOtpEmailText({
        heading: 'Verify your email',
        intro:
          'Enter this code to verify your email address and continue creating your Rentryt account.',
        code,
        expiryMinutes: EMAIL_VERIFY_TTL_MINUTES,
      }),
    });

    return {
      success: true,
      ...(includeRawTokenInResponse() ? { signupCode: code } : {}),
    };
  }

  /**
   * Step 2 of web's pre-registration email verification — confirms the code
   * from sendSignupCode(). Idempotent on repeat calls with the already-used
   * record so a double-submit doesn't error. register() later checks for
   * this row's `usedAt` to decide whether to create an already-verified,
   * signed-in account.
   */
  async verifySignupCode(params: { email: string; code: string }) {
    const email = normalizeEmail(params.email);
    const record = await this.prisma.signupVerification.findFirst({
      where: { email, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const invalid = () => new BadRequestException('invalid or expired code');

    if (!record) {
      throw invalid();
    }
    if (record.usedAt) {
      return { success: true };
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw invalid();
    }
    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await this.prisma.signupVerification.update({
        where: { id: record.id },
        data: { expiresAt: new Date(0) },
      });
      throw invalid();
    }
    if (record.token !== params.code.trim()) {
      await this.prisma.signupVerification.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid();
    }

    await this.prisma.signupVerification.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return { success: true };
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
        phoneVerified: true,
        identityVerified: true,
        identityDocumentType: true,
        identityDocumentLast4: true,
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

    if (!user.emailVerified) {
      throw new ForbiddenException('email not verified');
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
      body: `Your Rentryt verification code is ${code}. It expires in ${EMAIL_VERIFY_TTL_MINUTES} minutes.`,
      data: { code, expiryMinutes: EMAIL_VERIFY_TTL_MINUTES },
    });

    return {
      success: true,
      ...(includeRawTokenInResponse() ? { emailVerificationCode: code } : {}),
    };
  }

  /**
   * Marking the email verified is also the moment a fresh registration
   * becomes a real session — register() deliberately issues no accessToken,
   * so this is the first (and, alongside login(), only) place one is
   * signed. Returns the same {accessToken, user} shape as login() so the
   * caller can treat a successful verification as an immediate sign-in.
   */
  async verifyEmail(params: { email: string; code: string }) {
    const email = normalizeEmail(params.email);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        phoneVerified: true,
        identityVerified: true,
        identityDocumentType: true,
        identityDocumentLast4: true,
        name: true,
        phone: true,
      },
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

    const accessToken = await this.signToken(user.id, user.email, user.role);
    return {
      accessToken,
      user: { ...user, emailVerified: true },
    };
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
      body: `Your Rentryt password reset code is ${code}. It expires in ${PASSWORD_RESET_TTL_MINUTES} minutes. If you didn't request this, you can ignore this email.`,
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
  async requestPhoneVerification(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phone: true, email: true },
    });
    if (!user?.phone?.trim()) {
      throw new BadRequestException('add a phone number to your profile first');
    }

    const code = await this.issueOtp(
      user.id,
      'PHONE_VERIFY',
      EMAIL_VERIFY_TTL_MINUTES,
    );

    await this.notifications.notify(user.id, {
      type: NotificationType.PHONE_VERIFICATION,
      title: 'Verify your phone number',
      body: `Your Rentryt phone verification code is ${code}. It expires in ${EMAIL_VERIFY_TTL_MINUTES} minutes.`,
      data: { code, expiryMinutes: EMAIL_VERIFY_TTL_MINUTES },
    });

    return {
      success: true,
      ...(includeRawTokenInResponse() ? { phoneVerificationCode: code } : {}),
    };
  }

  async verifyPhone(userId: string, code: string) {
    const record = await this.consumeOtp(userId, 'PHONE_VERIFY', code);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { phoneVerified: true },
      }),
      this.prisma.token.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);
    return { success: true };
  }

  private async issueOtp(
    userId: string,
    type: 'EMAIL_VERIFY' | 'PHONE_VERIFY' | 'PASSWORD_RESET',
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
    type: 'EMAIL_VERIFY' | 'PHONE_VERIFY' | 'PASSWORD_RESET',
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
