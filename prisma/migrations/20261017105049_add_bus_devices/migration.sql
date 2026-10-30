-- CreateTable
CREATE TABLE "BusDevice" (
    "id" TEXT NOT NULL,
    "busId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusDevice_tokenHash_key" ON "BusDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "BusDevice_busId_idx" ON "BusDevice"("busId");

-- AddForeignKey
ALTER TABLE "BusDevice" ADD CONSTRAINT "BusDevice_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
