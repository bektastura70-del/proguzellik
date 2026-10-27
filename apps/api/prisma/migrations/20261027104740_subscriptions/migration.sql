-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('STARTER', 'PROFESSIONAL', 'SMART');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "onlineBookingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "planCode" "PlanCode" NOT NULL DEFAULT 'PROFESSIONAL';

-- CreateTable
CREATE TABLE "Plan" (
    "code" "PlanCode" NOT NULL,
    "name" TEXT NOT NULL,
    "maxStaff" INTEGER NOT NULL,
    "monthlyPrice" DECIMAL(12,2) NOT NULL,
    "yearlyPrice" DECIMAL(12,2) NOT NULL,
    "features" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("code")
);

-- Paketler (fiyatlar yer tutucudur; SaaS sahibi panelinden güncellenir)
INSERT INTO "Plan" ("code", "name", "maxStaff", "monthlyPrice", "yearlyPrice", "features", "sortOrder") VALUES
  ('STARTER', 'Başlangıç', 3, 499.00, 4990.00, ARRAY['CRM','APPOINTMENTS','ONLINE_BOOKING','FINANCE','PACKAGES'], 1),
  ('PROFESSIONAL', 'Profesyonel', 8, 999.00, 9990.00, ARRAY['CRM','APPOINTMENTS','ONLINE_BOOKING','FINANCE','PACKAGES','STOCK','REPORTS','WHATSAPP'], 2),
  ('SMART', 'Akıllı', 20, 1799.00, 17990.00, ARRAY['CRM','APPOINTMENTS','ONLINE_BOOKING','FINANCE','PACKAGES','STOCK','REPORTS','WHATSAPP','AI_ASSISTANT'], 3);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planCode" "PlanCode" NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_tenantId_idx" ON "Subscription"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_id_key" ON "Subscription"("tenantId", "id");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_tenantId_createdAt_idx" ON "SubscriptionPayment"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_tenantId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "subscriptionId") REFERENCES "Subscription"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS
SELECT app_secure_tenant_table(t) FROM unnest(ARRAY['Subscription', 'SubscriptionPayment']) AS t;
-- Abonelik ve ödeme kayıtlarını yalnızca platform yazar; işletme yalnızca okur.
REVOKE INSERT, UPDATE, DELETE ON "Subscription", "SubscriptionPayment" FROM app_tenant;
GRANT INSERT, UPDATE ON "Subscription", "SubscriptionPayment" TO app_platform;

-- Plan: herkes okuyabilir, yalnızca platform değiştirir.
ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Plan" FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_read ON "Plan" FOR SELECT USING (true);
GRANT SELECT ON "Plan" TO app_tenant;
GRANT SELECT, UPDATE ON "Plan" TO app_platform;

-- İşletme kendi kaydında yalnızca profil alanlarını değiştirebilir
-- (durum, paket ve deneme süresi yalnızca platform tarafından değişir).
REVOKE UPDATE ON "Tenant" FROM app_tenant;
GRANT UPDATE ("name", "phone", "email", "address", "timezone", "onlineBookingEnabled", "updatedAt") ON "Tenant" TO app_tenant;
