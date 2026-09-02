import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Param,
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

import { AdminService } from './admin.service';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('invalid body');
  }
  return value as Record<string, unknown>;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  async stats(@AuthUserParam() user: AuthUser) {
    return await this.admin.stats(user);
  }

  @Get('users')
  async users(
    @AuthUserParam() user: AuthUser,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return await this.admin.users(user, {
      role,
      status,
      search,
      page,
      pageSize,
    });
  }

  @Get('users/:id')
  async user(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.admin.user(user, id);
  }

  @Get('listings')
  async listings(
    @AuthUserParam() user: AuthUser,
    @Query('status') status?: string,
    @Query('ownerId') ownerId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return await this.admin.listings(user, {
      status,
      ownerId,
      search,
      page,
      pageSize,
    });
  }

  @Get('bookings')
  async bookings(
    @AuthUserParam() user: AuthUser,
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('renterId') renterId?: string,
    @Query('listingId') listingId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return await this.admin.bookings(user, {
      status,
      paymentStatus,
      renterId,
      listingId,
      page,
      pageSize,
    });
  }

  @Get('bookings/:id')
  async booking(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.admin.booking(user, id);
  }

  @Get('payments')
  async payments(
    @AuthUserParam() user: AuthUser,
    @Query('status') status?: string,
    @Query('purpose') purpose?: string,
    @Query('payerId') payerId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return await this.admin.listPayments(user, {
      status,
      purpose,
      payerId,
      search,
      page,
      pageSize,
    });
  }

  @Get('payments/:id')
  async payment(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.admin.getPayment(user, id);
  }

  @Get('reviews')
  async reviews(
    @AuthUserParam() user: AuthUser,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return await this.admin.reviews(user, { status, page, pageSize });
  }

  @Get('conversations')
  async conversations(
    @AuthUserParam() user: AuthUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return await this.admin.conversationsList(user, { page, pageSize });
  }

  @Patch('users/:id/status')
  async setUserStatus(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    const status = data.status;
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') {
      throw new BadRequestException('status must be ACTIVE or SUSPENDED');
    }
    return await this.admin.setUserStatus(user, id, status);
  }

  @Get('owner-applications')
  async ownerApplications(
    @AuthUserParam() user: AuthUser,
    @Query('status') status?: string,
  ) {
    return await this.admin.ownerApplications(user, status);
  }

  @Patch('owner-applications/:userId/decision')
  async decideOwnerApplication(
    @AuthUserParam() user: AuthUser,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    const decision = data.decision;
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      throw new BadRequestException("decision must be 'APPROVE' or 'REJECT'");
    }
    return await this.admin.decideOwnerApplication(user, userId, decision);
  }

  @Patch('reviews/:id/moderate')
  async moderateReview(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    const status = data.status;
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      throw new BadRequestException('status must be APPROVED or REJECTED');
    }
    return await this.admin.moderateReview(user, id, status);
  }

  @Get('audit-logs')
  async auditLogs(
    @AuthUserParam() user: AuthUser,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('actorId') actorId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return await this.admin.auditLogs(user, {
      action,
      targetType,
      actorId,
      page,
      pageSize,
    });
  }

  @Get('fee-rules')
  async feeRules(@AuthUserParam() user: AuthUser) {
    return await this.admin.feeRules(user);
  }

  @Patch('fee-rules/:key')
  async updateFeeRule(
    @AuthUserParam() user: AuthUser,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    const value = data.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException('value must be a number');
    }
    return await this.admin.updateFeeRule(user, key, value);
  }

  @Get('analytics/trends')
  async analyticsTrends(@AuthUserParam() user: AuthUser) {
    return await this.admin.analyticsTrends(user);
  }

  /**
   * Manual refund trigger (e.g. dispute resolution) — see AdminService.refundPayment.
   * `id` is the Payment row's own id (not a booking id).
   */
  @Post('payments/:id/refund')
  async refundPayment(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
  ) {
    return await this.admin.refundPayment(user, id);
  }

  /**
   * Manual, admin-only owner payout trigger (deliberately not automatic) —
   * see AdminService.processPayout / PayoutsService.process.
   */
  @Post('payouts/:id/process')
  async processPayout(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
  ) {
    return await this.admin.processPayout(user, id);
  }

  /**
   * Read-only support visibility — identical shape to
   * GET /conversations/:id/messages, but no write counterpart exists here:
   * admins must never be able to send-as a participant or alter history.
   */
  @Get('conversations/:id/messages')
  async conversationMessages(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
  ) {
    return await this.admin.conversationMessages(user, id);
  }
}
