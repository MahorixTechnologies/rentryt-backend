import type { ListingStatus } from '@prisma/client';

/**
 * A listing is publicly visible (searchable, bookable, reviewable) only once
 * it has been approved by an admin.
 */
export function isListingPublic(status: ListingStatus): boolean {
  return status === 'APPROVED';
}

/**
 * A listing only counts as featured while its purchase (or admin-set)
 * window hasn't expired. `featuredUntil: null` means "no expiry" — the
 * admin-only override path leaves it permanently featured.
 */
export function isFeaturedActive(listing: {
  featured: boolean;
  featuredUntil: Date | null;
}): boolean {
  return (
    listing.featured &&
    (!listing.featuredUntil || listing.featuredUntil > new Date())
  );
}
