import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
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

function makeToken() {
  return randomBytes(24).toString('hex');
}

/**
 * Response fields carrying a raw verification/reset token exist only for
 * local dev and the demo frontends (which read the token straight off the
 * response when no email server is wired up) — production must never leak
 * a token that should only ever reach the user's inbox, so this is the one
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
      select: { id: true, email: true, role: true, emailVerified: true, name: true, phone: true },
    });

    const token = makeToken();
    await this.prisma.token.create({
      data: {
        userId: user.id,
        type: 'EMAIL_VERIFY',
        token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    });

    await this.notifications.notify(user.id, {
      type: NotificationType.EMAIL_VERIFICATION,
      title: 'Verify your email',
      body: `Your BlueRock verification code is ${token}. It expires in 24 hours.`,
    });

    const accessToken = await this.signToken(
      user.id,
      user.email,
      user.role as unknown as UserRole,
    );

    return {
      accessToken,
      user,
      ...(includeRawTokenInResponse() ? { emailVerificationToken: token } : {}),
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

    const accessToken = await this.signToken(
      user.id,
      user.email,
      user.role as unknown as UserRole,
    );
    const { passwordHash, ...safeUser } = user;
    return { accessToken, user: safeUser };
  }

  async requestEmailVerification(emailInput: string) {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return { success: true };

    const token = makeToken();
    await this.prisma.token.create({
      data: {
        userId: user.id,
        type: 'EMAIL_VERIFY',
        token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    });

    await this.notifications.notify(user.id, {
      type: NotificationType.EMAIL_VERIFICATION,
      title: 'Verify your email',
      body: `Your BlueRock verification code is ${token}. It expires in 24 hours.`,
    });

    return {
      success: true,
      ...(includeRawTokenInResponse() ? { emailVerificationToken: token } : {}),
    };
  }

  async verifyEmail(token: string) {
    const record = await this.prisma.token.findUnique({ where: { token } });
    if (!record || record.type !== 'EMAIL_VERIFY') {
      throw new BadRequestException('invalid token');
    }
    if (record.usedAt) {
      throw new BadRequestException('token already used');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('token expired');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerified: true },
      }),
      this.prisma.token.update({
        where: { token },
        data: { usedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  async forgotPassword(emailInput: string) {
    const email = normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return { success: true };

    const token = makeToken();
    await this.prisma.token.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 30),
      },
    });

    await this.notifications.notify(user.id, {
      type: NotificationType.PASSWORD_RESET,
      title: 'Reset your password',
      body: `Your BlueRock password reset code is ${token}. It expires in 30 minutes. If you didn't request this, you can ignore this email.`,
    });

    return {
      success: true,
      ...(includeRawTokenInResponse() ? { passwordResetToken: token } : {}),
    };
  }

  async resetPassword(params: { token: string; newPassword: string }) {
    const password = requirePassword(params.newPassword);
    const record = await this.prisma.token.findUnique({ where: { token: params.token } });
    if (!record || record.type !== 'PASSWORD_RESET') {
      throw new BadRequestException('invalid token');
    }
    if (record.usedAt) {
      throw new BadRequestException('token already used');
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('token expired');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.token.update({
        where: { token: params.token },
        data: { usedAt: new Date() },
      }),
    ]);

    return { success: true };
  }

  private async signToken(userId: string, email: string, role: UserRole) {
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN', '7d') as StringValue;
    return await this.jwt.signAsync(
      { sub: userId, email, role },
      { expiresIn },
    );
  }
}
