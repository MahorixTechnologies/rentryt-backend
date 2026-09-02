/**
 * Emails created by prisma/seed.ts. Listings owned by these accounts are
 * sample/demo data, not real host inventory — hidden from the public feed
 * unless the viewer is themselves signed in as one of these accounts (so
 * QA/demos can still see the seeded catalogue).
 */
export const DEMO_ACCOUNT_EMAILS = [
  'admin@bluerock.com',
  'landlord@bluerock.com',
  'landlord2@bluerock.com',
  'renter@bluerock.com',
  'renter2@bluerock.com',
  'suspended@bluerock.com',
];

export function isDemoAccountEmail(email: string | null | undefined): boolean {
  return !!email && DEMO_ACCOUNT_EMAILS.includes(email.trim().toLowerCase());
}
