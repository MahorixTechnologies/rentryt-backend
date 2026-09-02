import { BadRequestException, Body, Controller, Post } from '@nestjs/common';

import { UserRole } from '../../common/types/auth';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body()
    body: {
      email?: unknown;
      password?: unknown;
      role?: unknown;
      phone?: unknown;
      name?: unknown;
    },
  ) {
    const email = body.email;
    const password = body.password;
    const role = body.role;
    const phone = body.phone;
    const name = body.name;

    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new BadRequestException('email is required');
    }
    if (typeof password !== 'string') {
      throw new BadRequestException('password is required');
    }

    const resolvedRole =
      role === UserRole.LANDLORD || role === UserRole.RENTER ? role : undefined;

    return await this.auth.register({
      email,
      password,
      role: resolvedRole,
      phone: typeof phone === 'string' ? phone : undefined,
      name: typeof name === 'string' ? name : undefined,
    });
  }

  @Post('login')
  async login(@Body() body: { email?: unknown; password?: unknown }) {
    const email = body.email;
    const password = body.password;
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new BadRequestException('email is required');
    }
    if (typeof password !== 'string') {
      throw new BadRequestException('password is required');
    }
    return await this.auth.login({ email, password });
  }

  @Post('request-email-verification')
  async requestEmailVerification(@Body() body: { email?: unknown }) {
    const email = body.email;
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new BadRequestException('email is required');
    }
    return await this.auth.requestEmailVerification(email);
  }

  @Post('verify-email')
  async verifyEmail(@Body() body: { email?: unknown; code?: unknown }) {
    const email = body.email;
    const code = body.code;
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new BadRequestException('email is required');
    }
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new BadRequestException('code is required');
    }
    return await this.auth.verifyEmail({ email, code });
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email?: unknown }) {
    const email = body.email;
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new BadRequestException('email is required');
    }
    return await this.auth.forgotPassword(email);
  }

  @Post('reset-password')
  async resetPassword(
    @Body() body: { email?: unknown; code?: unknown; newPassword?: unknown },
  ) {
    const email = body.email;
    const code = body.code;
    const newPassword = body.newPassword;
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new BadRequestException('email is required');
    }
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new BadRequestException('code is required');
    }
    if (typeof newPassword !== 'string') {
      throw new BadRequestException('newPassword is required');
    }
    return await this.auth.resetPassword({ email, code, newPassword });
  }
}
