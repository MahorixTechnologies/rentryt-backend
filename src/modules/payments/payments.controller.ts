import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { AuthUserParam } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthUser } from '../../common/types/auth';

import { PaymentsService } from './payments.service';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('invalid body');
  }
  return value as Record<string, unknown>;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('initiate')
  @UseGuards(JwtAuthGuard)
  async initiate(@AuthUserParam() user: AuthUser, @Body() body: unknown) {
    const data = asRecord(body);

    if (data.purpose !== 'BOOKING' && data.purpose !== 'FEATURED_LISTING') {
      throw new BadRequestException('purpose must be BOOKING or FEATURED_LISTING');
    }
    if (data.provider !== 'PAYSTACK' && data.provider !== 'FLUTTERWAVE') {
      throw new BadRequestException('provider must be PAYSTACK or FLUTTERWAVE');
    }
    if (typeof data.targetId !== 'string' || !data.targetId.trim()) {
      throw new BadRequestException('targetId is required');
    }
    if (typeof data.callbackUrl !== 'string' || !data.callbackUrl.trim()) {
      throw new BadRequestException('callbackUrl is required');
    }

    return await this.payments.initiate(user, {
      purpose: data.purpose,
      provider: data.provider,
      targetId: data.targetId,
      callbackUrl: data.callbackUrl,
    });
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard)
  async verify(@AuthUserParam() user: AuthUser, @Body() body: unknown) {
    const data = asRecord(body);
    if (typeof data.reference !== 'string' || !data.reference.trim()) {
      throw new BadRequestException('reference is required');
    }

    return await this.payments.verify({
      reference: data.reference,
      providerTransactionId:
        typeof data.providerTransactionId === 'string' ? data.providerTransactionId : undefined,
      callerId: user.id,
    });
  }

  @Post('webhooks/paystack')
  @HttpCode(200)
  async paystackWebhook(@Req() req: RawBodyRequest<Request>) {
    return await this.payments.handleWebhook(
      'PAYSTACK',
      req.rawBody ?? Buffer.from(''),
      req.headers as Record<string, string | undefined>,
    );
  }

  @Post('webhooks/flutterwave')
  @HttpCode(200)
  async flutterwaveWebhook(@Req() req: RawBodyRequest<Request>) {
    return await this.payments.handleWebhook(
      'FLUTTERWAVE',
      req.rawBody ?? Buffer.from(''),
      req.headers as Record<string, string | undefined>,
    );
  }
}
