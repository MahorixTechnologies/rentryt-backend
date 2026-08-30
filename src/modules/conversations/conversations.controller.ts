import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AuthUserParam } from '../../common/decorators/auth-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';

import { ConversationsService } from './conversations.service';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('invalid body');
  }
  return value as Record<string, unknown>;
}

@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.RENTER, UserRole.LANDLORD)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  /**
   * Body is `{listingId}` (a fresh listing inquiry — RENTER only) or
   * `{bookingId}` (renter or the listing's owning landlord) — see
   * ConversationsService.createConversation for the participant checks.
   */
  @Post()
  async create(
    @AuthUserParam() user: AuthUser,
    @Body() body: { listingId?: unknown; bookingId?: unknown },
  ) {
    const data = asRecord(body);
    const { listingId, bookingId } = data;
    if (listingId !== undefined && typeof listingId !== 'string') {
      throw new BadRequestException('listingId must be a string');
    }
    if (bookingId !== undefined && typeof bookingId !== 'string') {
      throw new BadRequestException('bookingId must be a string');
    }

    return await this.conversations.createConversation(user, {
      listingId: typeof listingId === 'string' ? listingId : undefined,
      bookingId: typeof bookingId === 'string' ? bookingId : undefined,
    });
  }

  @Get()
  async list(@AuthUserParam() user: AuthUser) {
    return await this.conversations.listMine(user);
  }

  @Get(':id/messages')
  async messages(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.conversations.getMessages(user, id);
  }

  @Post(':id/messages')
  async send(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { body?: unknown },
  ) {
    const data = asRecord(body);
    const text = data.body;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new BadRequestException('body is required');
    }
    return await this.conversations.sendMessage(user, id, text);
  }

  @Patch(':id/read')
  async markRead(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.conversations.markRead(user, id);
  }
}
