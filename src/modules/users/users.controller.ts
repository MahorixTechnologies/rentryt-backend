import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthUserParam } from '../../common/decorators/auth-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

import { UsersService } from './users.service';

const meSelect = {
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
  createdAt: true,
} as const;

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@AuthUserParam() user: AuthUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: meSelect,
    });
    return dbUser;
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(
    @AuthUserParam() user: AuthUser,
    @Body() body: { name?: unknown; phone?: unknown },
  ) {
    const name = body.name;
    const phone = body.phone;
    if (name != null && typeof name !== 'string') {
      throw new BadRequestException('name must be a string');
    }
    if (phone != null && typeof phone !== 'string') {
      throw new BadRequestException('phone must be a string');
    }

    const existing = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { phone: true },
    });
    const nextPhone =
      typeof phone === 'string' ? phone.trim() : undefined;
    const phoneChanged =
      nextPhone != null && nextPhone !== (existing?.phone ?? '');

    return await this.prisma.user.update({
      where: { id: user.id },
      data: {
        name: typeof name === 'string' ? name.trim() : undefined,
        phone: nextPhone,
        ...(phoneChanged ? { phoneVerified: false } : {}),
      },
      select: meSelect,
    });
  }

  @Post('me/request-phone-verification')
  @UseGuards(JwtAuthGuard)
  async requestPhoneVerification(@AuthUserParam() user: AuthUser) {
    return await this.auth.requestPhoneVerification(user.id);
  }

  @Post('me/verify-phone')
  @UseGuards(JwtAuthGuard)
  async verifyPhone(
    @AuthUserParam() user: AuthUser,
    @Body() body: { code?: unknown },
  ) {
    const code = body.code;
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new BadRequestException('code is required');
    }
    return await this.auth.verifyPhone(user.id, code);
  }

  @Post('me/identity')
  @UseGuards(JwtAuthGuard)
  async submitIdentity(
    @AuthUserParam() user: AuthUser,
    @Body() body: { documentType?: unknown; documentNumber?: unknown },
  ) {
    const documentType = body.documentType;
    const documentNumber = body.documentNumber;
    if (documentType !== 'NIN' && documentType !== 'VALID_ID') {
      throw new BadRequestException("documentType must be 'NIN' or 'VALID_ID'");
    }
    if (typeof documentNumber !== 'string' || documentNumber.trim().length === 0) {
      throw new BadRequestException('documentNumber is required');
    }
    return await this.users.submitIdentity(user.id, {
      documentType,
      documentNumber,
    });
  }

  /**
   * Lets a landlord look up a renter by exact email when creating a booking
   * on their behalf (see BookingsController.createForRenter). Scoped to
   * LANDLORD and returns only the minimal fields needed to confirm identity
   * and pass a renterId back in — never a full user directory.
   */
  @Get('lookup-renter')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.LANDLORD)
  async lookupRenter(@Query('email') email?: string) {
    if (typeof email !== 'string' || email.trim().length === 0) {
      throw new BadRequestException('email is required');
    }
    const renter = await this.prisma.user.findFirst({
      where: { email: email.trim().toLowerCase(), role: 'RENTER' },
      select: { id: true, name: true, email: true, phone: true },
    });
    if (!renter) {
      throw new NotFoundException('no renter found with that email');
    }
    return renter;
  }

  @Post('me/owner-application')
  @UseGuards(JwtAuthGuard)
  async applyForOwnerRole(@AuthUserParam() user: AuthUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, ownerApplicationStatus: true },
    });
    if (!dbUser) {
      throw new NotFoundException('user not found');
    }
    if (dbUser.role !== 'RENTER') {
      throw new BadRequestException(
        'only renters can apply to become a landlord',
      );
    }
    if (dbUser.ownerApplicationStatus === 'PENDING') {
      throw new BadRequestException('an owner application is already pending');
    }

    return await this.prisma.user.update({
      where: { id: user.id },
      data: {
        ownerApplicationStatus: 'PENDING',
        ownerApplicationAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        role: true,
        ownerApplicationStatus: true,
        ownerApplicationAt: true,
      },
    });
  }
}
