-- CreateTable
CREATE TABLE "StopApproach" (
    "id" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "tripId" TEXT,
    "direction" "Direction" NOT NULL,
    "ring" TEXT NOT NULL,
    "radiusMeters" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StopApproach_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StopApproach_date_idx" ON "StopApproach"("date");

-- CreateIndex
CREATE UNIQUE INDEX "StopApproach_busId_stopId_direction_ring_date_key" ON "StopApproach"("busId", "stopId", "direction", "ring", "date");

-- AddForeignKey
ALTER TABLE "StopApproach" ADD CONSTRAINT "StopApproach_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopApproach" ADD CONSTRAINT "StopApproach_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "Stop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopApproach" ADD CONSTRAINT "StopApproach_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
