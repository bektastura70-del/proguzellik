-- Siteden doğrudan satın alma. Yalnız yeni tablo + IyzicoCheckout'ta iki sütun boş bırakılabilir hâle gelir;
-- mevcut satırların hepsinde tenantId/userId dolu olduğundan veri değişmez.

CREATE TABLE "PurchaseRequest" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "billingCycle" "BillingCycle" NOT NULL,
    "kvkkNoticeVersion" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "checkoutCount" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PurchaseRequest_tokenHash_key" ON "PurchaseRequest"("tokenHash");
CREATE INDEX "PurchaseRequest_email_idx" ON "PurchaseRequest"("email");
CREATE INDEX "PurchaseRequest_phone_idx" ON "PurchaseRequest"("phone");
CREATE INDEX "PurchaseRequest_expiresAt_idx" ON "PurchaseRequest"("expiresAt");

ALTER TABLE "IyzicoCheckout" ALTER COLUMN "tenantId" DROP NOT NULL;
ALTER TABLE "IyzicoCheckout" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "IyzicoCheckout" ADD COLUMN "purchaseRequestId" UUID;
CREATE INDEX "IyzicoCheckout_purchaseRequestId_idx" ON "IyzicoCheckout"("purchaseRequestId");
-- Her ödeme oturumu ya bir işletmeye ya da bir satın alma kaydına bağlıdır.
ALTER TABLE "IyzicoCheckout" ADD CONSTRAINT "IyzicoCheckout_owner_check" CHECK ("tenantId" IS NOT NULL OR "purchaseRequestId" IS NOT NULL);

ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_phone_format" CHECK ("phone" ~ '^\+90[0-9]{10}$');

-- Satın alma kaydında parola özeti ve kişisel veri var: yalnız platform rolü erişir.
REVOKE ALL ON "PurchaseRequest" FROM app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PurchaseRequest" TO app_platform;
ALTER TABLE "PurchaseRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseRequest" FORCE ROW LEVEL SECURITY;
-- app_tenant için hiçbir satır görünmez (platform rolü BYPASSRLS ile etkilenmez).
CREATE POLICY no_tenant_access ON "PurchaseRequest" USING (false) WITH CHECK (false);
