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

import { BookingsService } from './bookings.service';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('invalid body');
  }
  return value as Record<string, unknown>;
}

@Controller('bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @Roles(UserRole.RENTER)
  async create(
    @AuthUserParam() user: AuthUser,
    @Body()
    body: { listingId?: unknown; startDate?: unknown; endDate?: unknown },
  ) {
    const data = asRecord(body);
    const listingId = data.listingId;
    const startDate = data.startDate;
    const endDate = data.endDate;

    if (typeof listingId !== 'string' || listingId.trim().length === 0) {
      throw new BadRequestException('listingId is required');
    }
    if (typeof startDate !== 'string' || typeof endDate !== 'string') {
      throw new BadRequestException('startDate and endDate are required');
    }

    return await this.bookings.createBooking(user, {
      listingId,
      startDate,
      endDate,
    });
  }

  @Get('me')
  @Roles(UserRole.RENTER)
  async myBookings(@AuthUserParam() user: AuthUser) {
    return await this.bookings.listMyBookings(user);
  }

  @Get('owner')
  @Roles(UserRole.LANDLORD)
  async ownerBookings(@AuthUserParam() user: AuthUser) {
    return await this.bookings.listOwnerBookings(user);
  }

  /** LANDLORD books one of their own listings on behalf of a renter. */
  @Post('owner')
  @Roles(UserRole.LANDLORD)
  async createForRenter(
    @AuthUserParam() user: AuthUser,
    @Body()
    body: {
      listingId?: unknown;
      renterId?: unknown;
      startDate?: unknown;
      endDate?: unknown;
    },
  ) {
    const data = asRecord(body);
    const listingId = data.listingId;
    const renterId = data.renterId;
    const startDate = data.startDate;
    const endDate = data.endDate;

    if (typeof listingId !== 'string' || listingId.trim().length === 0) {
      throw new BadRequestException('listingId is required');
    }
    if (typeof renterId !== 'string' || renterId.trim().length === 0) {
      throw new BadRequestException('renterId is required');
    }
    if (typeof startDate !== 'string' || typeof endDate !== 'string') {
      throw new BadRequestException('startDate and endDate are required');
    }

    return await this.bookings.createBookingForRenter(user, {
      listingId,
      renterId,
      startDate,
      endDate,
    });
  }

  @Patch(':id/decision')
  @Roles(UserRole.LANDLORD)
  async decide(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { decision?: unknown },
  ) {
    const data = asRecord(body);
    const decision = data.decision;
    if (decision !== 'ACCEPT' && decision !== 'REJECT') {
      throw new BadRequestException('decision must be ACCEPT or REJECT');
    }
    return await this.bookings.decideBooking(user, id, decision);
  }

  /** Manual admin reconciliation override — see BookingsService.markPaid. */
  @Patch(':id/pay')
  @Roles(UserRole.ADMIN)
  async pay(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.bookings.markPaid(user, id);
  }

  /** LANDLORD owning the listing, or ADMIN — see BookingsService.checkIn. */
  @Post(':id/check-in')
  @Roles(UserRole.LANDLORD, UserRole.ADMIN)
  async checkIn(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.bookings.checkIn(user, id);
  }

  /** LANDLORD owning the listing, or ADMIN — see BookingsService.checkOut. */
  @Post(':id/check-out')
  @Roles(UserRole.LANDLORD, UserRole.ADMIN)
  async checkOut(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.bookings.checkOut(user, id);
  }

  /**
   * The renter who owns the booking, the LANDLORD who owns the listing, or
   * ADMIN — see BookingsService.cancel. Multi-role ownership is enforced
   * inside the service since RolesGuard only checks role membership, not
   * per-resource ownership.
   */
  @Post(':id/cancel')
  @Roles(UserRole.RENTER, UserRole.LANDLORD, UserRole.ADMIN)
  async cancel(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.bookings.cancel(user, id);
  }
}
