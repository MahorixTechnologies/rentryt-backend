/*
  Warnings:

  - A unique constraint covering the columns `[listingId,renterId]` on the table `Review` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'ARCHIVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ListingType" ADD VALUE 'EntireProperty';
ALTER TYPE "ListingType" ADD VALUE 'Duplex';
ALTER TYPE "ListingType" ADD VALUE 'Studio';
ALTER TYPE "ListingType" ADD VALUE 'SingleRoom';
ALTER TYPE "ListingType" ADD VALUE 'SharedRoom';
ALTER TYPE "ListingType" ADD VALUE 'Hostel';
ALTER TYPE "ListingType" ADD VALUE 'StudentHousing';
ALTER TYPE "ListingType" ADD VALUE 'HotelRoom';
ALTER TYPE "ListingType" ADD VALUE 'Other';

-- CreateIndex
CREATE UNIQUE INDEX "Review_listingId_renterId_key" ON "Review"("listingId", "renterId");

-- CreateIndex
CREATE INDEX "Token_userId_type_idx" ON "Token"("userId", "type");
