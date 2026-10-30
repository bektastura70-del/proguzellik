-- AlterTable
ALTER TABLE "OutboundEmail" ADD COLUMN     "actorId" UUID,
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "payload" JSONB,
ADD COLUMN     "tenantId" UUID;

-- CreateTable
CREATE TABLE "EmailTemplateOverride" (
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "EmailTemplateOverride_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "OutboundEmail_status_createdAt_idx" ON "OutboundEmail"("status", "createdAt");


-- Şablon metinleri yalnızca platform rolüne açık; işletme rolünün yetkisi yok.
REVOKE ALL ON "EmailTemplateOverride" FROM app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "EmailTemplateOverride" TO app_platform;

-- tenantId sütunu eklendiği için kiracı izolasyonu politikası (işletme rolünün zaten yetkisi yok).
ALTER TABLE "OutboundEmail" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboundEmail" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OutboundEmail" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
