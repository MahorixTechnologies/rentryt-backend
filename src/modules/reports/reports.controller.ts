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

import { ReportsService } from './reports.service';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('invalid body');
  }
  return value as Record<string, unknown>;
}

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  async create(@AuthUserParam() user: AuthUser, @Body() body: unknown) {
    const data = asRecord(body);
    const targetType = data.targetType;
    const targetId = data.targetId;
    const reason = data.reason;
    const details = data.details;

    if (typeof targetType !== 'string') {
      throw new BadRequestException('targetType is required');
    }
    if (typeof targetId !== 'string' || !targetId.trim()) {
      throw new BadRequestException('targetId is required');
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      throw new BadRequestException('reason is required');
    }
    if (details != null && typeof details !== 'string') {
      throw new BadRequestException('details must be a string');
    }

    return await this.reports.createReport(user, {
      targetType,
      targetId,
      reason,
      details: details ?? null,
    });
  }
}

@Controller('admin/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  async list(@AuthUserParam() user: AuthUser, @Query('status') status?: string) {
    return await this.reports.listForAdmin(user, status);
  }

  @Patch(':id/resolve')
  async resolve(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    const decision = data.decision;
    if (decision !== 'RESOLVE' && decision !== 'DISMISS') {
      throw new BadRequestException("decision must be 'RESOLVE' or 'DISMISS'");
    }
    const note = data.note;
    if (note != null && typeof note !== 'string') {
      throw new BadRequestException('note must be a string');
    }

    return await this.reports.resolve(user, id, decision, note ?? null);
  }
}
