-- CreateEnum
CREATE TYPE "StorageObjectStatus" AS ENUM ('PENDING', 'UPLOADED', 'ATTACHED', 'ABORTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "StorageObject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "status" "StorageObjectStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "listingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageObject_key_key" ON "StorageObject"("key");

-- CreateIndex
CREATE INDEX "StorageObject_userId_idx" ON "StorageObject"("userId");

-- CreateIndex
CREATE INDEX "StorageObject_status_expiresAt_idx" ON "StorageObject"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "StorageObject_publicUrl_idx" ON "StorageObject"("publicUrl");

-- CreateIndex
CREATE INDEX "StorageObject_listingId_idx" ON "StorageObject"("listingId");

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
