import type { AuthUser } from '../types/auth';
import { UserRole } from '../types/auth';

export type ListingDetailLevel = 'GUEST' | 'FULL';

/** City or general area — hide street-level address for guests. */
export function publicAreaLocation(location: string): string {
  const parts = location
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'Sign in to view the exact address';
  if (parts.length === 1) return `${parts[0]} area · sign in for full address`;
  return `${parts[parts.length - 1]} area · sign in for full address`;
}

export function listingDetailLevel(
  viewer: AuthUser | null | undefined,
  ownerId: string,
): ListingDetailLevel {
  if (!viewer) return 'GUEST';
  if (viewer.role === UserRole.ADMIN) return 'FULL';
  if (viewer.id === ownerId) return 'FULL';
  return 'FULL';
}

type ListingWithOwner = {
  id: string;
  title: string;
  description: string;
  location: string;
  pricePerNight: number;
  currency: string;
  rooms: number;
  bathrooms: number;
  type: string;
  images: string[];
  amenities: string[];
  rules: string[];
  owner: { id: string; name: string | null; phone: string | null; email: string };
  [key: string]: unknown;
};

export function applyGuestListingView<T extends ListingWithOwner>(
  listing: T,
  viewer: AuthUser | null | undefined,
): T & { detailLevel: ListingDetailLevel } {
  const level = listingDetailLevel(viewer, listing.owner.id);
  if (level === 'FULL') {
    return { ...listing, detailLevel: 'FULL' };
  }

  const teaser =
    listing.description.trim().length > 0
      ? `${listing.description.trim().slice(0, 160)}${listing.description.length > 160 ? '…' : ''}`
      : '';

  return {
    ...listing,
    detailLevel: 'GUEST',
    location: publicAreaLocation(listing.location),
    description: teaser,
    images: listing.images.slice(0, 1),
    amenities: listing.amenities.slice(0, 4),
    rules: [],
    owner: {
      ...listing.owner,
      phone: null,
      email: '',
    },
  };
}

export function applyGuestListingCard<
  T extends {
    owner?: { id?: string; name?: string | null; phone?: string | null; email?: string };
  },
>(listing: T, viewer: AuthUser | null | undefined): T {
  if (viewer) return listing;
  const owner = listing.owner;
  if (!owner) return listing;
  return {
    ...listing,
    owner: {
      ...owner,
      phone: null,
      email: undefined,
    },
  };
}
