import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthUserParam } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/types/auth';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@AuthUserParam() user: AuthUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        name: true,
        phone: true,
        createdAt: true,
      },
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

    return await this.prisma.user.update({
      where: { id: user.id },
      data: {
        name: typeof name === 'string' ? name.trim() : undefined,
        phone: typeof phone === 'string' ? phone.trim() : undefined,
      },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        name: true,
        phone: true,
      },
    });
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
