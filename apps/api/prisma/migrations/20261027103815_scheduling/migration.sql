-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('PANEL', 'ONLINE');

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "categoryId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMin" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "onlineBookable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffMember" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "displayName" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "color" TEXT,
    "commissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "onlineBookable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffService" (
    "tenantId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,

    CONSTRAINT "StaffService_pkey" PRIMARY KEY ("staffId","serviceId")
);

-- CreateTable
CREATE TABLE "WorkingHour" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,

    CONSTRAINT "WorkingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOff" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "staffId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
    "price" DECIMAL(12,2) NOT NULL,
    "source" "BookingSource" NOT NULL DEFAULT 'PANEL',
    "notes" TEXT,
    "cancelReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_tenantId_id_key" ON "ServiceCategory"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_tenantId_name_key" ON "ServiceCategory"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Service_tenantId_id_key" ON "Service"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_tenantId_id_key" ON "StaffMember"("tenantId", "id");

-- CreateIndex
CREATE INDEX "WorkingHour_tenantId_staffId_idx" ON "WorkingHour"("tenantId", "staffId");

-- CreateIndex
CREATE INDEX "TimeOff_tenantId_staffId_startsAt_idx" ON "TimeOff"("tenantId", "staffId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_startsAt_idx" ON "Appointment"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_staffId_startsAt_idx" ON "Appointment"("tenantId", "staffId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_customerId_idx" ON "Appointment"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_tenantId_id_key" ON "Appointment"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_tenantId_categoryId_fkey" FOREIGN KEY ("tenantId", "categoryId") REFERENCES "ServiceCategory"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "StaffMember"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffService" ADD CONSTRAINT "StaffService_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHour" ADD CONSTRAINT "WorkingHour_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "StaffMember"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "StaffMember"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "StaffMember"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
SELECT app_secure_tenant_table(t) FROM unnest(ARRAY[
  'ServiceCategory', 'Service', 'StaffMember', 'StaffService', 'WorkingHour', 'TimeOff', 'Appointment'
]) AS t;

-- Veri bütünlüğü
ALTER TABLE "Service" ADD CONSTRAINT service_duration_positive CHECK ("durationMin" BETWEEN 5 AND 720);
ALTER TABLE "Service" ADD CONSTRAINT service_price_nonneg CHECK ("price" >= 0);
ALTER TABLE "StaffMember" ADD CONSTRAINT staff_commission_range CHECK ("commissionRate" BETWEEN 0 AND 100);
ALTER TABLE "WorkingHour" ADD CONSTRAINT working_hour_valid
  CHECK ("weekday" BETWEEN 0 AND 6 AND "startMin" >= 0 AND "endMin" <= 1440 AND "startMin" < "endMin");
ALTER TABLE "TimeOff" ADD CONSTRAINT time_off_valid CHECK ("startsAt" < "endsAt");
ALTER TABLE "Appointment" ADD CONSTRAINT appointment_time_valid CHECK ("startsAt" < "endsAt");

-- Aynı personel için çakışan aktif randevu veritabanı düzeyinde engellenir.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Appointment" ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist ("staffId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("status" IN ('BOOKED', 'CONFIRMED', 'COMPLETED'));
