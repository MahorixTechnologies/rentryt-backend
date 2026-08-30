import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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

import { DisputesService } from './disputes.service';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('invalid body');
  }
  return value as Record<string, unknown>;
}

@Controller('bookings/:id/disputes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RENTER, UserRole.LANDLORD)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  async create(
    @AuthUserParam() user: AuthUser,
    @Param('id') bookingId: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    const reason = data.reason;
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new BadRequestException('reason is required');
    }

    return await this.disputes.raiseDispute(user, bookingId, reason);
  }
}

@Controller('admin/disputes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  async list(@AuthUserParam() user: AuthUser, @Query('status') status?: string) {
    return await this.disputes.listForAdmin(user, status);
  }

  @Patch(':id/decision')
  async decide(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    const status = data.status;
    if (status !== 'RESOLVED' && status !== 'REJECTED' && status !== 'UNDER_REVIEW') {
      throw new BadRequestException("status must be 'RESOLVED', 'REJECTED', or 'UNDER_REVIEW'");
    }
    const resolutionNotes = data.resolutionNotes;
    if (resolutionNotes != null && typeof resolutionNotes !== 'string') {
      throw new BadRequestException('resolutionNotes must be a string');
    }

    return await this.disputes.decide(user, id, status, resolutionNotes ?? null);
  }
}
