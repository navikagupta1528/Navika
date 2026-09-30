-- AlterTable
ALTER TABLE "EmergencyAlert" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "resolutionNote" TEXT;
