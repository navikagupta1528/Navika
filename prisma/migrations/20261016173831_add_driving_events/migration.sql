-- CreateEnum
CREATE TYPE "DrivingEventType" AS ENUM ('HARSH_BRAKING', 'HARD_ACCELERATION', 'OVERSPEED');

-- CreateTable
CREATE TABLE "DrivingEvent" (
    "id" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "driverId" TEXT,
    "tripId" TEXT,
    "type" "DrivingEventType" NOT NULL,
    "magnitudeKph" DOUBLE PRECISION NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrivingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DrivingEvent_driverId_at_idx" ON "DrivingEvent"("driverId", "at");

-- CreateIndex
CREATE INDEX "DrivingEvent_busId_at_idx" ON "DrivingEvent"("busId", "at");

-- AddForeignKey
ALTER TABLE "DrivingEvent" ADD CONSTRAINT "DrivingEvent_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrivingEvent" ADD CONSTRAINT "DrivingEvent_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrivingEvent" ADD CONSTRAINT "DrivingEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;
