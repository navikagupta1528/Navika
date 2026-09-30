-- AlterTable
ALTER TABLE "EtaCache" ADD COLUMN     "geometry" JSONB;

-- CreateIndex
CREATE INDEX "EtaCache_computedAt_idx" ON "EtaCache"("computedAt");
