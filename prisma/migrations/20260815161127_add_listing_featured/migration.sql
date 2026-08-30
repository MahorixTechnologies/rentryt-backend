-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Listing_featured_idx" ON "Listing"("featured");
