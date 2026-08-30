-- CreateTable
CREATE TABLE "FeeRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "FeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeeRule_key_key" ON "FeeRule"("key");

-- CreateIndex
CREATE INDEX "FeeRule_key_idx" ON "FeeRule"("key");

-- AddForeignKey
ALTER TABLE "FeeRule" ADD CONSTRAINT "FeeRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
