-- DropIndex
DROP INDEX "Token_token_key";

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "searchVector" tsvector;

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;
