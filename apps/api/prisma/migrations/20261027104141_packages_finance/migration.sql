-- CreateEnum
CREATE TYPE "PackageStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'OTHER');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "customerPackageId" UUID;

-- CreateTable
CREATE TABLE "PackageTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "validityDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPackage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "templateId" UUID,
    "serviceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "totalSessions" INTEGER NOT NULL,
    "usedSessions" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(12,2) NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "CustomerPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionUsage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerPackageId" UUID NOT NULL,
    "appointmentId" UUID,
    "staffId" UUID,
    "note" TEXT,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceTransaction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "customerId" UUID,
    "appointmentId" UUID,
    "customerPackageId" UUID,
    "staffId" UUID,
    "refundOfId" UUID,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PackageTemplate_tenantId_id_key" ON "PackageTemplate"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CustomerPackage_tenantId_customerId_idx" ON "CustomerPackage"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPackage_tenantId_id_key" ON "CustomerPackage"("tenantId", "id");

-- CreateIndex
CREATE INDEX "SessionUsage_tenantId_customerPackageId_idx" ON "SessionUsage"("tenantId", "customerPackageId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionUsage_tenantId_appointmentId_key" ON "SessionUsage"("tenantId", "appointmentId");

-- CreateIndex
CREATE INDEX "FinanceTransaction_tenantId_occurredAt_idx" ON "FinanceTransaction"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "FinanceTransaction_tenantId_customerId_idx" ON "FinanceTransaction"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceTransaction_tenantId_id_key" ON "FinanceTransaction"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_customerPackageId_fkey" FOREIGN KEY ("tenantId", "customerPackageId") REFERENCES "CustomerPackage"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageTemplate" ADD CONSTRAINT "PackageTemplate_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_tenantId_templateId_fkey" FOREIGN KEY ("tenantId", "templateId") REFERENCES "PackageTemplate"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPackage" ADD CONSTRAINT "CustomerPackage_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionUsage" ADD CONSTRAINT "SessionUsage_tenantId_customerPackageId_fkey" FOREIGN KEY ("tenantId", "customerPackageId") REFERENCES "CustomerPackage"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionUsage" ADD CONSTRAINT "SessionUsage_tenantId_appointmentId_fkey" FOREIGN KEY ("tenantId", "appointmentId") REFERENCES "Appointment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_tenantId_appointmentId_fkey" FOREIGN KEY ("tenantId", "appointmentId") REFERENCES "Appointment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_tenantId_customerPackageId_fkey" FOREIGN KEY ("tenantId", "customerPackageId") REFERENCES "CustomerPackage"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "StaffMember"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT "FinanceTransaction_tenantId_refundOfId_fkey" FOREIGN KEY ("tenantId", "refundOfId") REFERENCES "FinanceTransaction"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
SELECT app_secure_tenant_table(t) FROM unnest(ARRAY[
  'PackageTemplate', 'CustomerPackage', 'SessionUsage', 'FinanceTransaction'
]) AS t;

-- Mali kayıtlar değiştirilemez ve silinemez (ters kayıt/iade ile düzeltilir).
REVOKE UPDATE, DELETE ON "FinanceTransaction" FROM app_tenant;

ALTER TABLE "PackageTemplate" ADD CONSTRAINT pkg_tpl_valid CHECK ("sessionCount" BETWEEN 1 AND 200 AND "price" >= 0);
ALTER TABLE "CustomerPackage" ADD CONSTRAINT cust_pkg_sessions
  CHECK ("totalSessions" >= 1 AND "usedSessions" >= 0 AND "usedSessions" <= "totalSessions" AND "price" >= 0);
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT fin_amount_positive CHECK ("amount" > 0);
ALTER TABLE "FinanceTransaction" ADD CONSTRAINT fin_refund_link
  CHECK (("type" = 'REFUND') = ("refundOfId" IS NOT NULL));
