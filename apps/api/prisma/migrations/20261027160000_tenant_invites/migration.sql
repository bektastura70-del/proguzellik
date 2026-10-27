-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING_DELIVERY', 'SENT', 'ACCEPTED', 'REVOKED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT,
ADD COLUMN     "suspendedFromStatus" "TenantStatus";

-- CreateTable
CREATE TABLE "TenantInvite" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'OWNER',
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING_DELIVERY',
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" UUID,
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantInvite_tokenHash_key" ON "TenantInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "TenantInvite_tenantId_status_idx" ON "TenantInvite"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantInvite_email_idx" ON "TenantInvite"("email");

-- AddForeignKey
ALTER TABLE "TenantInvite" ADD CONSTRAINT "TenantInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bir işletmede aynı anda en fazla bir açık davet
CREATE UNIQUE INDEX "TenantInvite_one_open_per_tenant" ON "TenantInvite"("tenantId") WHERE "status" IN ('PENDING_DELIVERY', 'SENT');

-- Davetler yalnızca platform rolüyle yönetilir; işletme rolüne (app_tenant) hiçbir yetki verilmez.
ALTER TABLE "TenantInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantInvite" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantInvite"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
GRANT SELECT, INSERT, UPDATE ON "TenantInvite" TO app_platform;

-- Tenant tablosundaki tablo düzeyi UPDATE yetkisi önceki migrationda kaldırıldı; yeni sütunlar (suspendedAt, suspendedReason) işletme rolünce değiştirilemez.
