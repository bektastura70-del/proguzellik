-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('PROVIDER', 'MANUAL');

-- CreateEnum
CREATE TYPE "SubscriptionGrantAction" AS ENUM ('CREATED', 'EXTENDED', 'RENEWED', 'PLAN_CHANGED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "isComplimentary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "SubscriptionSource" NOT NULL DEFAULT 'PROVIDER';

-- CreateTable
CREATE TABLE "SubscriptionGrant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "action" "SubscriptionGrantAction" NOT NULL,
    "planCode" "PlanCode" NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "previousPeriodEnd" TIMESTAMP(3),
    "previousPlanCode" "PlanCode",
    "agreedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isComplimentary" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionGrant_requestId_key" ON "SubscriptionGrant"("requestId");

-- CreateIndex
CREATE INDEX "SubscriptionGrant_tenantId_createdAt_idx" ON "SubscriptionGrant"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "SubscriptionGrant" ADD CONSTRAINT "SubscriptionGrant_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "Subscription"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Mevcut abonelik ve ödeme kayıtları korunur: eski satırlar varsayılan olarak PROVIDER kalır.

-- Manuel abonelik sağlayıcı adı "manual" olmalı; sağlayıcılı abonelik ücretsiz işaretlenemez.
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_source_provider_check"
  CHECK (("source" = 'MANUAL' AND "provider" = 'manual') OR ("source" = 'PROVIDER' AND "provider" <> 'manual' AND "isComplimentary" = false));

-- Manuel aboneliğe gerçek tahsilat kaydı (SubscriptionPayment) bağlanamaz; manuel işlemler yalnızca SubscriptionGrant defterine yazılır.
CREATE OR REPLACE FUNCTION subscription_payment_requires_provider() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Subscription" s WHERE s."id" = NEW."subscriptionId" AND s."source" = 'MANUAL') THEN
    RAISE EXCEPTION 'Manuel aboneliğe ödeme kaydı eklenemez' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER subscription_payment_requires_provider
  BEFORE INSERT OR UPDATE ON "SubscriptionPayment"
  FOR EACH ROW EXECUTE FUNCTION subscription_payment_requires_provider();

-- Kaynak sonradan değiştirilemez (manuel ↔ sağlayıcılı dönüşüm yok; yeni abonelik açılır).
CREATE OR REPLACE FUNCTION subscription_source_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."source" <> OLD."source" OR NEW."provider" <> OLD."provider" THEN
    RAISE EXCEPTION 'Abonelik kaynağı değiştirilemez' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER subscription_source_immutable
  BEFORE UPDATE ON "Subscription"
  FOR EACH ROW EXECUTE FUNCTION subscription_source_immutable();

-- Defter yalnızca platform rolüyle, yalnızca ekleme/okuma. İşletme rolüne (app_tenant) yetki verilmez.
ALTER TABLE "SubscriptionGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubscriptionGrant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SubscriptionGrant"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
REVOKE ALL ON "SubscriptionGrant" FROM app_tenant;
GRANT SELECT, INSERT ON "SubscriptionGrant" TO app_platform;
