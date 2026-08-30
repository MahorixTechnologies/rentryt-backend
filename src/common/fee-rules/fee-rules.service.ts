import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

export const SERVICE_FEE_PERCENT_KEY = 'SERVICE_FEE_PERCENT';
export const SERVICE_FEE_PERCENT_DEFAULT = 10;

export const FEATURED_LISTING_PRICE_KEY = 'FEATURED_LISTING_PRICE';
export const FEATURED_LISTING_PRICE_DEFAULT = 5000;

/**
 * Shared accessor for generic key/value FeeRule rows (e.g. SERVICE_FEE_PERCENT).
 * Any module that needs to price something off a live-editable fee rule
 * should go through this service instead of reading FeeRule directly, so the
 * "value is a percent, fall back if missing" behavior stays in one place.
 */
@Injectable()
export class FeeRulesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the current value of the given fee rule key, interpreted as a
   * percentage (e.g. 10 means 10%). Falls back to `fallbackDefault` if the
   * rule does not exist yet.
   */
  async getPercent(key: string, fallbackDefault: number): Promise<number> {
    const rule = await this.prisma.feeRule.findUnique({
      where: { key },
      select: { value: true },
    });
    return rule?.value ?? fallbackDefault;
  }

  /**
   * Returns the current raw value of the given fee rule key (e.g. a flat
   * price rather than a percentage). Falls back to `fallbackDefault` if the
   * rule does not exist yet.
   */
  async getValue(key: string, fallbackDefault: number): Promise<number> {
    const rule = await this.prisma.feeRule.findUnique({
      where: { key },
      select: { value: true },
    });
    return rule?.value ?? fallbackDefault;
  }
}
