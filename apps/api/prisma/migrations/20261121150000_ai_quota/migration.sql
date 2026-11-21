-- CreateEnum
CREATE TYPE "AiCreditBucket" AS ENUM ('MONTHLY', 'PURCHASED');

-- CreateEnum
CREATE TYPE "AiCreditEntryType" AS ENUM ('MONTHLY_GRANT', 'MONTHLY_EXPIRE', 'PURCHASE_CREDIT', 'PURCHASE_EXPIRE', 'USAGE_DEBIT', 'REFUND_DEBIT', 'ADMIN_ADJUST');

-- CreateEnum
CREATE TYPE "AiCreditPurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "aiMonthlyCreditKurus" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ChannelConnection" ADD COLUMN     "aiDataConsentProvider" TEXT;

-- CreateTable
CREATE TABLE "AiBillingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "usdTry" DECIMAL(12,4) NOT NULL,
    "fxBuffer" DECIMAL(6,3) NOT NULL DEFAULT 1.10,
    "markup" DECIMAL(6,3) NOT NULL DEFAULT 3,
    "creditRatio" DECIMAL(6,3) NOT NULL DEFAULT 0.5,
    "trialCreditKurus" INTEGER NOT NULL DEFAULT 2500,
    "tenantDailyMaxUsd" DECIMAL(10,4) NOT NULL DEFAULT 2,
    "conversationMaxTokens" INTEGER NOT NULL DEFAULT 150000,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "AiBillingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWallet" (
    "tenantId" UUID NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "monthlyGrantKurus" INTEGER NOT NULL DEFAULT 0,
    "monthlyRemainingKurus" INTEGER NOT NULL DEFAULT 0,
    "purchasedRemainingKurus" INTEGER NOT NULL DEFAULT 0,
    "purchasedPeakKurus" INTEGER NOT NULL DEFAULT 0,
    "purchasedExpiresAt" TIMESTAMP(3),
    "warned80At" TIMESTAMP(3),
    "warned100At" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWallet_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "AiCreditLedger" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bucket" "AiCreditBucket" NOT NULL,
    "type" "AiCreditEntryType" NOT NULL,
    "amountKurus" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3),
    "usageEventId" UUID,
    "purchaseId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID,
    "messageId" UUID,
    "kind" TEXT NOT NULL DEFAULT 'chat',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "calls" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL,
    "cacheWriteTokens" INTEGER NOT NULL,
    "costMicroUsd" INTEGER NOT NULL,
    "debitKurus" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCreditPurchase" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "token" TEXT,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "creditKurus" INTEGER NOT NULL,
    "status" "AiCreditPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "iyzicoPaymentId" TEXT,
    "paymentTransactionIds" JSONB,
    "termsVersion" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "refundedCreditKurus" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiCreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiCreditLedger_idempotencyKey_key" ON "AiCreditLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AiCreditLedger_tenantId_createdAt_idx" ON "AiCreditLedger"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_messageId_idx" ON "AiUsageEvent"("messageId");

-- CreateIndex
CREATE INDEX "AiUsageEvent_tenantId_createdAt_idx" ON "AiUsageEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_conversationId_createdAt_idx" ON "AiUsageEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageEvent_createdAt_idx" ON "AiUsageEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiCreditPurchase_conversationId_key" ON "AiCreditPurchase"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiCreditPurchase_token_key" ON "AiCreditPurchase"("token");

-- CreateIndex
CREATE INDEX "AiCreditPurchase_tenantId_createdAt_idx" ON "AiCreditPurchase"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiCreditPurchase_status_createdAt_idx" ON "AiCreditPurchase"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AiWallet" ADD CONSTRAINT "AiWallet_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCreditLedger" ADD CONSTRAINT "AiCreditLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCreditPurchase" ADD CONSTRAINT "AiCreditPurchase_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Mevcut onaylar canlıda OpenAI metniyle verildi (AI_MODE=openai, 10.11.2026'dan beri). Sağlayıcı değişince onay geçersiz sayılır.
UPDATE "ChannelConnection" SET "aiDataConsentProvider" = 'openai' WHERE "aiDataConsentAt" IS NOT NULL;

-- Akıllı paket: her ay 500 TL iç değer (kuruş). Diğer paketler 0. SaaS sahibi paket düzenlemesinden değiştirebilir.
UPDATE "Plan" SET "aiMonthlyCreditKurus" = 50000 WHERE "code" = 'SMART';

-- Tek satırlık ayar tablosu
ALTER TABLE "AiBillingSettings" ADD CONSTRAINT "AiBillingSettings_singleton" CHECK ("id" = 1);
ALTER TABLE "AiBillingSettings" ADD CONSTRAINT "AiBillingSettings_values" CHECK ("usdTry" > 0 AND "fxBuffer" >= 1 AND "markup" >= 1 AND "creditRatio" > 0 AND "creditRatio" <= 1 AND "trialCreditKurus" >= 0 AND "tenantDailyMaxUsd" > 0 AND "conversationMaxTokens" > 0);
ALTER TABLE "AiCreditPurchase" ADD CONSTRAINT "AiCreditPurchase_amounts" CHECK ("netAmount" > 0 AND "grossAmount" >= "netAmount" AND "creditKurus" > 0 AND "refundedAmount" >= 0 AND "refundedCreditKurus" >= 0);

-- Defter yalnızca eklenir: güncelleme ve silme veritabanında engellenir.
CREATE OR REPLACE FUNCTION ai_credit_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Kullanım hakkı defteri değiştirilemez veya silinemez; ters kayıt girin' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ai_credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON "AiCreditLedger"
  FOR EACH ROW EXECUTE FUNCTION ai_credit_ledger_append_only();

-- Yalnız platform rolü yazar; işletme rolüne hiçbir yetki verilmez (salon yüzdeyi API'den okur).
ALTER TABLE "AiWallet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiWallet" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiWallet" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "AiCreditLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCreditLedger" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiCreditLedger" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "AiUsageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiUsageEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiUsageEvent" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "AiCreditPurchase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCreditPurchase" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiCreditPurchase" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());

REVOKE ALL ON "AiBillingSettings", "AiWallet", "AiCreditLedger", "AiUsageEvent", "AiCreditPurchase" FROM app_tenant;
GRANT SELECT, INSERT, UPDATE ON "AiBillingSettings", "AiWallet", "AiUsageEvent", "AiCreditPurchase" TO app_platform;
GRANT SELECT, INSERT ON "AiCreditLedger" TO app_platform;
