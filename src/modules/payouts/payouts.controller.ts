import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import { AuthUserParam } from '../../common/decorators/auth-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';

import { PayoutsService } from './payouts.service';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('invalid body');
  }
  return value as Record<string, unknown>;
}

@Controller('payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post('setup')
  @Roles(UserRole.LANDLORD)
  async setup(@AuthUserParam() user: AuthUser, @Body() body: unknown) {
    const data = asRecord(body);
    if (data.provider !== 'PAYSTACK' && data.provider !== 'FLUTTERWAVE') {
      throw new BadRequestException('provider must be PAYSTACK or FLUTTERWAVE');
    }
    if (typeof data.bankCode !== 'string' || !data.bankCode.trim()) {
      throw new BadRequestException('bankCode is required');
    }
    if (typeof data.accountNumber !== 'string' || !data.accountNumber.trim()) {
      throw new BadRequestException('accountNumber is required');
    }
    if (typeof data.accountName !== 'string' || !data.accountName.trim()) {
      throw new BadRequestException('accountName is required');
    }

    return await this.payouts.setup(user, {
      provider: data.provider,
      bankCode: data.bankCode,
      accountNumber: data.accountNumber,
      accountName: data.accountName,
    });
  }

  /** LANDLORD sees only their own payouts; ADMIN sees all (optionally filtered by ?status=). */
  @Get()
  @Roles(UserRole.LANDLORD, UserRole.ADMIN)
  async list(@AuthUserParam() user: AuthUser, @Query('status') status?: string) {
    return await this.payouts.list(user, status);
  }

  /** Same ownership rule as list() — the owning landlord or ADMIN. */
  @Get(':id')
  @Roles(UserRole.LANDLORD, UserRole.ADMIN)
  async getOne(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.payouts.getOne(user, id);
  }
}
