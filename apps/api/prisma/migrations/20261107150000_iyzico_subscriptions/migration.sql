-- CreateEnum
CREATE TYPE "IyzicoCheckoutStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "IyzicoPlanLink" (
    "id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "planPriceId" UUID NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "productReferenceCode" TEXT NOT NULL,
    "pricingPlanReferenceCode" TEXT NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IyzicoPlanLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IyzicoCheckout" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "token" TEXT,
    "planCode" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "planPriceId" UUID NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "pricingPlanReferenceCode" TEXT NOT NULL,
    "status" "IyzicoCheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "subscriptionReferenceCode" TEXT,
    "customerReferenceCode" TEXT,
    "error" TEXT,
    "subscriptionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IyzicoCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IyzicoWebhookEvent" (
    "id" UUID NOT NULL,
    "iyziReferenceCode" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "subscriptionReferenceCode" TEXT NOT NULL,
    "orderReferenceCode" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "result" TEXT,

    CONSTRAINT "IyzicoWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IyzicoPlanLink_pricingPlanReferenceCode_key" ON "IyzicoPlanLink"("pricingPlanReferenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "IyzicoPlanLink_environment_planPriceId_billingCycle_key" ON "IyzicoPlanLink"("environment", "planPriceId", "billingCycle");

-- CreateIndex
CREATE UNIQUE INDEX "IyzicoCheckout_conversationId_key" ON "IyzicoCheckout"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "IyzicoCheckout_token_key" ON "IyzicoCheckout"("token");

-- CreateIndex
CREATE INDEX "IyzicoCheckout_tenantId_createdAt_idx" ON "IyzicoCheckout"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IyzicoWebhookEvent_iyziReferenceCode_key" ON "IyzicoWebhookEvent"("iyziReferenceCode");


-- Yalnız eklenen tablolar; mevcut veri değişmez.
-- iyzico tabloları yalnız platform rolüyle erişilir; işletme rolüne (app_tenant) yetki verilmez.
REVOKE ALL ON "IyzicoPlanLink", "IyzicoCheckout", "IyzicoWebhookEvent" FROM app_tenant;
GRANT SELECT, INSERT, UPDATE ON "IyzicoPlanLink", "IyzicoCheckout", "IyzicoWebhookEvent" TO app_platform;

-- tenantId sütunu olan her tablo gibi: RLS açık ve zorunlu (platform rolü BYPASSRLS ile etkilenmez).
ALTER TABLE "IyzicoCheckout" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IyzicoCheckout" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IyzicoCheckout" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
