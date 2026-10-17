import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { recordAuditLog } from '../../common/audit/audit-log';
import {
  DEMO_ACCOUNT_EMAILS,
  isDemoAccountEmail,
} from '../../common/constants/demo-accounts';
import type { AuthUser } from '../../common/types/auth';
import { UserRole } from '../../common/types/auth';
import {
  applyGuestListingCard,
  applyGuestListingView,
} from '../../common/listings/listing-guest-view';
import {
  isFeaturedActive,
  isListingPublic,
} from '../../common/listings/listing-visibility';
import { StorageUploadsService } from '../../common/storage/storage-uploads.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageUploads: StorageUploadsService,
  ) {}

  async listPublic(params: {
    q?: string;
    location?: string;
    minPrice?: number;
    maxPrice?: number;
    type?: string;
    rooms?: number;
    viewer?: AuthUser | null;
    viewerEmail?: string | null;
  }) {
    const q = params.q?.trim();
    const location = params.location?.trim();
    const listingType =
      typeof params.type === 'string' &&
      PUBLIC_TYPES.includes(params.type as CreateListingInput['type'])
        ? (params.type as CreateListingInput['type'])
        : undefined;
    const viewerEmail = params.viewer?.email ?? params.viewerEmail ?? null;
    const viewerIsDemo = isDemoAccountEmail(viewerEmail);

    const listings = await this.prisma.listing.findMany({
      where: {
        status: 'APPROVED',
        ...(viewerIsDemo
          ? {}
          : { owner: { email: { notIn: DEMO_ACCOUNT_EMAILS } } }),
        ...(q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { location: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(location
          ? { location: { contains: location, mode: 'insensitive' } }
          : {}),
        ...(listingType ? { type: listingType } : {}),
        ...(params.rooms ? { rooms: { gte: params.rooms } } : {}),
        ...(params.minPrice != null
          ? { pricePerNight: { gte: params.minPrice } }
          : {}),
        ...(params.maxPrice != null
          ? { pricePerNight: { lte: params.maxPrice } }
          : {}),
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

    return listings.map((listing) =>
      applyGuestListingCard(
        {
          ...listing,
          featured: isFeaturedActive(listing),
        },
        params.viewer,
      ),
    );
  }

  /**
   * Global full-text search, backing the shared `GET /search` endpoint used
   * by web, mobile, and admin alike. Distinct from listPublic()'s `q` filter
   * (a simple `contains` match on 3 columns, still used by the structured
   * filter UI) — this ranks by relevance across title/location/amenities/
   * description via the "searchVector" generated column (see
   * prisma/migrations/*_listing_search_vector*), with title matches weighted
   * above location, above amenities, above description.
   */
  async globalSearch(params: {
    q: string;
    limit?: number;
    viewerEmail?: string | null;
  }) {
    const q = params.q.trim();
    if (!q) return { listings: [] };

    const limit = Math.min(Math.max(Math.trunc(params.limit ?? 20), 1), 50);
    const viewerIsDemo = isDemoAccountEmail(params.viewerEmail);

    const ranked = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "Listing"
      WHERE status = 'APPROVED'
        AND "searchVector" @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank("searchVector", plainto_tsquery('english', ${q})) DESC
      LIMIT ${limit}
    `;
    if (!ranked.length) return { listings: [] };

    const ids = ranked.map((row) => row.id);
    const listings = await this.prisma.listing.findMany({
      where: {
        id: { in: ids },
        ...(viewerIsDemo
          ? {}
          : { owner: { email: { notIn: DEMO_ACCOUNT_EMAILS } } }),
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
    });

    // findMany's `id: { in: ids }` does not preserve the raw query's rank
    // order, so re-sort to match `ranked` (and drop any id findMany filtered
    // out, e.g. a demo listing hidden from a non-demo viewer).
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter(
        (listing): listing is NonNullable<typeof listing> => listing != null,
      )
      .map((listing) => ({ ...listing, featured: isFeaturedActive(listing) }));

    return { listings: ordered };
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
    } else if (
      isDemoAccountEmail(listing.owner.email) &&
      !isDemoAccountEmail(viewer?.email) &&
      viewer?.role !== UserRole.ADMIN &&
      viewer?.id !== listing.ownerId
    ) {
      throw new NotFoundException('listing not found');
    }

    return applyGuestListingView(
      { ...listing, featured: isFeaturedActive(listing) },
      viewer,
    );
  }

  async checkAvailability(
    listingId: string,
    startDate: string,
    endDate: string,
    viewer?: AuthUser | null,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, ownerId: true },
    });
    if (!listing) throw new NotFoundException('listing not found');
    if (!isListingPublic(listing.status)) {
      if (!viewer) throw new NotFoundException('listing not found');
      if (viewer.role !== UserRole.ADMIN && viewer.id !== listing.ownerId) {
        throw new NotFoundException('listing not found');
      }
    }

    const start = this.parseAvailabilityDate(startDate);
    const end = this.parseAvailabilityDate(endDate);
    const nights = this.diffNights(start, end);
    if (nights <= 0) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const overlapping = await this.prisma.booking.findFirst({
      where: {
        listingId,
        status: { in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] },
        NOT: {
          OR: [{ endDate: { lte: start } }, { startDate: { gte: end } }],
        },
      },
      select: { id: true },
    });

    return { available: !overlapping, nights };
  }

  private parseAvailabilityDate(value: string): Date {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new BadRequestException('dates must be YYYY-MM-DD');
    }
    const [y, m, d] = trimmed.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      Number.isNaN(dt.getTime()) ||
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== m - 1 ||
      dt.getUTCDate() !== d
    ) {
      throw new BadRequestException('invalid date');
    }
    return dt;
  }

  private diffNights(start: Date, end: Date) {
    const ms = end.getTime() - start.getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }

  async create(owner: AuthUser, input: CreateListingInput) {
    if (owner.role !== UserRole.LANDLORD) {
      throw new ForbiddenException('only landlords can create listings');
    }

    if (
      !input.title.trim() ||
      !input.location.trim() ||
      input.pricePerNight <= 0
    ) {
      throw new BadRequestException('invalid listing fields');
    }

    const listing = await this.prisma.listing.create({
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

    await this.storageUploads.syncListingImages({
      userId: owner.id,
      listingId: listing.id,
      nextImages: listing.images,
      previousImages: [],
    });

    return listing;
  }

  async update(
    owner: AuthUser,
    id: string,
    patch: Partial<CreateListingInput>,
  ) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('listing not found');
    if (owner.role !== UserRole.ADMIN && owner.id !== listing.ownerId) {
      throw new ForbiddenException('not allowed');
    }

    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        ...(patch.title != null ? { title: patch.title.trim() } : {}),
        ...(patch.description != null
          ? { description: patch.description.trim() }
          : {}),
        ...(patch.location != null ? { location: patch.location.trim() } : {}),
        ...(patch.pricePerNight != null
          ? { pricePerNight: Math.round(patch.pricePerNight) }
          : {}),
        ...(patch.currency != null ? { currency: patch.currency } : {}),
        ...(patch.rooms != null
          ? { rooms: Math.max(0, Math.round(patch.rooms)) }
          : {}),
        ...(patch.bathrooms != null
          ? { bathrooms: Math.max(0, Math.round(patch.bathrooms)) }
          : {}),
        ...(patch.type != null ? { type: patch.type } : {}),
        ...(patch.images != null ? { images: patch.images } : {}),
        ...(patch.amenities != null ? { amenities: patch.amenities } : {}),
        ...(patch.rules != null ? { rules: patch.rules } : {}),
        status: owner.role === UserRole.ADMIN ? listing.status : 'PENDING',
      },
    });

    if (patch.images != null) {
      await this.storageUploads.syncListingImages({
        userId: listing.ownerId,
        listingId: listing.id,
        nextImages: updated.images,
        previousImages: listing.images,
      });
    }

    return updated;
  }

  async appendImages(owner: AuthUser, id: string, urls: string[]) {
    const listing = await this.prisma.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('listing not found');
    if (owner.role !== UserRole.ADMIN && owner.id !== listing.ownerId) {
      throw new ForbiddenException('not allowed');
    }

    const updated = await this.prisma.listing.update({
      where: { id },
      data: { images: { push: urls } },
    });

    await this.storageUploads.syncListingImages({
      userId: listing.ownerId,
      listingId: listing.id,
      nextImages: updated.images,
      previousImages: listing.images,
    });

    return updated;
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

  async setStatus(
    admin: AuthUser,
    id: string,
    status: 'APPROVED' | 'REJECTED',
  ) {
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
    const base =
      listing.featuredUntil && listing.featuredUntil > now
        ? listing.featuredUntil
        : now;
    const featuredUntil = new Date(base);
    featuredUntil.setDate(
      featuredUntil.getDate() + FEATURED_LISTING_DURATION_DAYS,
    );

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
