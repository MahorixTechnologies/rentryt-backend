-- CreateEnum
CREATE TYPE "IdentityDocumentType" AS ENUM ('NIN', 'VALID_ID');

-- AlterEnum
ALTER TYPE "TokenType" ADD VALUE 'PHONE_VERIFY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "identityDocumentType" "IdentityDocumentType",
ADD COLUMN     "identityDocumentLast4" TEXT,
ADD COLUMN     "identityVerified" BOOLEAN NOT NULL DEFAULT false;
