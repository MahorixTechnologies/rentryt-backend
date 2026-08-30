import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { recordAuditLog } from '../../common/audit/audit-log';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import { isFeaturedActive, isListingPublic } from '../../common/listings/listing-visibility';
import { PrismaService } from '../../prisma/prisma.service';

const FEATURED_LISTING_DURATION_DAYS = 30;

type CreateListingInput = {
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
};

const PUBLIC_TYPES: readonly CreateListingInput['type'][] = [
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
] as const;

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic(params: {
    q?: string;
    location?: string;
    minPrice?: number;
    maxPrice?: number;
    type?: string;
    rooms?: number;
  }) {
    const q = params.q?.trim();
    const location = params.location?.trim();
    const listingType =
      typeof params.type === 'string' &&
      PUBLIC_TYPES.includes(params.type as CreateListingInput['type'])
        ? (params.type as CreateListingInput['type'])
        : undefined;

    const listings = await this.prisma.listing.findMany({
      where: {
        status: 'APPROVED',
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { location: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(location ? { location: { contains: location, mode: 'insensitive' } } : {}),
        ...(listingType ? { type: listingType } : {}),
        ...(params.rooms ? { rooms: { gte: params.rooms } } : {}),
        ...(params.minPrice != null ? { pricePerNight: { gte: params.minPrice } } : {}),
        ...(params.maxPrice != null ? { pricePerNight: { lte: params.maxPrice } } : {}),
      },
      select: {
        id: true,
        title: true,
        location: true,
        pricePerNight: true,
        currency: true,
        rooms: true,
        bathrooms: true,
        type: true,
        images: true,
        amenities: true,
        status: true,
        featured: true,
        featuredUntil: true,
        owner: { select: { id: true, name: true, phone: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return listings.map((listing) => ({ ...listing, featured: isFeaturedActive(listing) }));
  }

  async listMine(owner: AuthUser) {
    if (owner.role !== UserRole.LANDLORD) {
      throw new ForbiddenException('only landlords can view their listings');
    }

    return await this.prisma.listing.findMany({
      where: { ownerId: owner.id },
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, name: true, phone: true, email: true } },
      },
    });
  }

  async getById(id: string, viewer?: AuthUser | null) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, phone: true, email: true } },
      },
    });

    if (!listing) throw new NotFoundException('listing not found');

    if (!isListingPublic(listing.status)) {
      if (!viewer) throw new NotFoundException('listing not found');
      if (viewer.role !== UserRole.ADMIN && viewer.id !== listing.ownerId) {
        throw new NotFoundException('listing not found');
      }
    }

    return { ...listing, featured: isFeaturedActive(listing) };
  }

  async create(owner: AuthUser, input: CreateListingInput) {
    if (owner.role !== UserRole.LANDLORD) {
      throw new ForbiddenException('only landlords can create listings');
    }

    if (!input.title.trim() || !input.location.trim() || input.pricePerNight <= 0) {
      throw new BadRequestException('invalid listing fields');
    }

    return await this.prisma.listing.create({
      data: {
        ownerId: owner.id,
        status: 'PENDING',
        title: input.title.trim(),
        description: input.description.trim(),
        location: input.location.trim(),
        pricePerNight: Math.round(input.pricePerNight),
        currency: input.currency,
        rooms: Math.max(0, Math.round(input.rooms)),
        bathrooms: Math.max(0, Math.round(input.bathrooms)),
        type: input.type,
        images: input.images,
        amenities: input.amenities,
        rules: input.rules,
      },
    });
  }

  async update(owner: AuthUser, id: string, patch: Partial<CreateListingInput>) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('listing not found');
    if (owner.role !== UserRole.ADMIN && owner.id !== listing.ownerId) {
      throw new ForbiddenException('not allowed');
    }

    return await this.prisma.listing.update({
      where: { id },
      data: {
        ...(patch.title != null ? { title: patch.title.trim() } : {}),
        ...(patch.description != null ? { description: patch.description.trim() } : {}),
        ...(patch.location != null ? { location: patch.location.trim() } : {}),
        ...(patch.pricePerNight != null ? { pricePerNight: Math.round(patch.pricePerNight) } : {}),
        ...(patch.currency != null ? { currency: patch.currency } : {}),
        ...(patch.rooms != null ? { rooms: Math.max(0, Math.round(patch.rooms)) } : {}),
        ...(patch.bathrooms != null ? { bathrooms: Math.max(0, Math.round(patch.bathrooms)) } : {}),
        ...(patch.type != null ? { type: patch.type } : {}),
        ...(patch.images != null ? { images: patch.images } : {}),
        ...(patch.amenities != null ? { amenities: patch.amenities } : {}),
        ...(patch.rules != null ? { rules: patch.rules } : {}),
        status: owner.role === UserRole.ADMIN ? listing.status : 'PENDING',
      },
    });
  }

  async appendImages(owner: AuthUser, id: string, urls: string[]) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('listing not found');
    if (owner.role !== UserRole.ADMIN && owner.id !== listing.ownerId) {
      throw new ForbiddenException('not allowed');
    }

    return await this.prisma.listing.update({
      where: { id },
      data: { images: { push: urls } },
    });
  }

  async remove(owner: AuthUser, id: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('listing not found');
    if (owner.role !== UserRole.ADMIN && owner.id !== listing.ownerId) {
      throw new ForbiddenException('not allowed');
    }

    return await this.prisma.listing.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }

  async setStatus(admin: AuthUser, id: string, status: 'APPROVED' | 'REJECTED') {
    if (admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('admin only');
    }

    const before = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!before) throw new NotFoundException('listing not found');

    const updated = await this.prisma.listing.update({
      where: { id },
      data: { status },
    });

    await recordAuditLog(this.prisma, {
      actorId: admin.id,
      action: 'LISTING_STATUS_CHANGE',
      targetType: 'Listing',
      targetId: id,
      metadata: { from: before.status, to: status },
    });

    return updated;
  }

  async setFeatured(admin: AuthUser, id: string, featured: boolean) {
    if (admin.role !== UserRole.ADMIN) {
      throw new ForbiddenException('admin only');
    }

    const before = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, featured: true, featuredUntil: true },
    });
    if (!before) throw new NotFoundException('listing not found');

    const updated = await this.prisma.listing.update({
      where: { id },
      // Clearing featuredUntil whenever admin unfeatures a listing stops a
      // stale expiry from silently reactivating it if admin re-features it
      // later without an explicit new purchase.
      data: { featured, featuredUntil: featured ? before.featuredUntil : null },
    });

    await recordAuditLog(this.prisma, {
      actorId: admin.id,
      action: 'LISTING_FEATURED_CHANGE',
      targetType: 'Listing',
      targetId: id,
      metadata: {
        from: before.featured,
        to: featured,
        featuredUntil: updated.featuredUntil,
      },
    });

    return updated;
  }

  /**
   * Called only by PaymentsService once a real Paystack/Flutterwave payment
   * for FEATURED_LISTING has been independently verified — ownership/status
   * authorization already happened in PaymentsService.initiate(), so this is
   * just the renewal-safe activation effect, no auth checks here.
   */
  async activateFeaturedListing(listingId: string, paymentReference: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, featuredUntil: true },
    });
    if (!listing) throw new NotFoundException('listing not found');

    const now = new Date();
    const base = listing.featuredUntil && listing.featuredUntil > now ? listing.featuredUntil : now;
    const featuredUntil = new Date(base);
    featuredUntil.setDate(featuredUntil.getDate() + FEATURED_LISTING_DURATION_DAYS);

    const updated = await this.prisma.listing.update({
      where: { id: listingId },
      data: { featured: true, featuredUntil },
    });

    await recordAuditLog(this.prisma, {
      actorId: updated.ownerId,
      action: 'LISTING_FEATURED_PURCHASED',
      targetType: 'Listing',
      targetId: listingId,
      metadata: {
        days: FEATURED_LISTING_DURATION_DAYS,
        expiresAt: featuredUntil,
        paymentReference,
      },
    });

    return updated;
  }
}
