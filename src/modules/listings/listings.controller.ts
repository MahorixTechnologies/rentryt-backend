import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthUserParam } from '../../common/decorators/auth-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';

import { ListingsService } from './listings.service';

type JwtPayload = { sub: string; email: string; role: UserRole };

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('invalid body');
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback = 0) {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === 'string').map((v) => v);
}

type ListingPatch = Partial<{
  title: string;
  description: string;
  location: string;
  pricePerNight: number;
  currency: 'NGN' | 'USD';
  rooms: number;
  bathrooms: number;
  type:
    | 'EntireProperty'
    | 'Apartment'
    | 'House'
    | 'Duplex'
    | 'Studio'
    | 'SingleRoom'
    | 'SharedRoom'
    | 'Hostel'
    | 'StudentHousing'
    | 'HotelRoom'
    | 'Other';
  images: string[];
  amenities: string[];
  rules: string[];
}>;

const VALID_LISTING_TYPES = new Set<ListingPatch['type']>([
  'EntireProperty',
  'Apartment',
  'House',
  'Duplex',
  'Studio',
  'SingleRoom',
  'SharedRoom',
  'Hostel',
  'StudentHousing',
  'HotelRoom',
  'Other',
]);

function readListingType(value: unknown): NonNullable<ListingPatch['type']> {
  if (
    typeof value === 'string' &&
    VALID_LISTING_TYPES.has(value as ListingPatch['type'])
  ) {
    return value as NonNullable<ListingPatch['type']>;
  }
  return 'Apartment';
}

@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Best-effort viewer identity for endpoints that stay public either way
   * (anonymous browsing must keep working) but want to know who's asking —
   * e.g. to let a demo account see the seeded catalogue. Never throws: a
   * missing/expired/invalid token is treated the same as no token.
   */
  private async decodeViewer(authHeader?: string): Promise<AuthUser | null> {
    const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      return { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      return null;
    }
  }

  @Get()
  async list(
    @Headers('authorization') authHeader: string | undefined,
    @Query('q') q?: string,
    @Query('location') location?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('type') type?: string,
    @Query('rooms') rooms?: string,
  ) {
    const min = minPrice != null ? Number(minPrice) : undefined;
    const max = maxPrice != null ? Number(maxPrice) : undefined;
    const r = rooms != null ? Number(rooms) : undefined;
    const viewer = await this.decodeViewer(authHeader);
    return await this.listings.listPublic({
      q,
      location,
      minPrice: Number.isFinite(min) ? min : undefined,
      maxPrice: Number.isFinite(max) ? max : undefined,
      type,
      rooms: Number.isFinite(r) ? r : undefined,
      viewerEmail: viewer?.email ?? null,
    });
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.LANDLORD)
  async mine(@AuthUserParam() user: AuthUser) {
    return await this.listings.listMine(user);
  }

  @Get(':id')
  async get(
    @Param('id') id: string,
    @Headers('authorization') authHeader: string | undefined,
  ) {
    const viewer = await this.decodeViewer(authHeader);
    return await this.listings.getById(id, viewer);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.LANDLORD)
  async create(@AuthUserParam() user: AuthUser, @Body() body: unknown) {
    const data = asRecord(body);

    return await this.listings.create(user, {
      title: readString(data.title),
      description: readString(data.description),
      location: readString(data.location),
      pricePerNight: readNumber(data.pricePerNight),
      currency: data.currency === 'USD' ? 'USD' : 'NGN',
      rooms: readNumber(data.rooms),
      bathrooms: readNumber(data.bathrooms),
      type: readListingType(data.type),
      images: readStringArray(data.images),
      amenities: readStringArray(data.amenities),
      rules: readStringArray(data.rules),
    });
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.LANDLORD, UserRole.ADMIN)
  async update(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    const patch: ListingPatch = {};

    if (data.title != null) patch.title = readString(data.title);
    if (data.description != null)
      patch.description = readString(data.description);
    if (data.location != null) patch.location = readString(data.location);
    if (data.pricePerNight != null)
      patch.pricePerNight = readNumber(data.pricePerNight);
    if (data.currency != null)
      patch.currency = data.currency === 'USD' ? 'USD' : 'NGN';
    if (data.rooms != null) patch.rooms = readNumber(data.rooms);
    if (data.bathrooms != null) patch.bathrooms = readNumber(data.bathrooms);
    if (data.type != null) patch.type = readListingType(data.type);
    if (data.images != null) patch.images = readStringArray(data.images);
    if (data.amenities != null)
      patch.amenities = readStringArray(data.amenities);
    if (data.rules != null) patch.rules = readStringArray(data.rules);

    return await this.listings.update(user, id, patch);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.LANDLORD, UserRole.ADMIN)
  async remove(@AuthUserParam() user: AuthUser, @Param('id') id: string) {
    return await this.listings.remove(user, id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async setStatus(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    const status = data.status;
    if (status !== 'APPROVED' && status !== 'REJECTED') {
      throw new BadRequestException('status must be APPROVED or REJECTED');
    }
    return await this.listings.setStatus(user, id, status);
  }

  @Patch(':id/featured')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async setFeatured(
    @AuthUserParam() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const data = asRecord(body);
    if (typeof data.featured !== 'boolean') {
      throw new BadRequestException('featured must be a boolean');
    }
    return await this.listings.setFeatured(user, id, data.featured);
  }
}
