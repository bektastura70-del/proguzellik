-- Paket kodu sabit enum yerine metin: SaaS sahibi yeni paket oluşturabilir.
-- Veri korunur (USING ::text), bütünlük Plan(code) yabancı anahtarlarıyla sağlanır.
ALTER TABLE "Tenant" DROP CONSTRAINT "Tenant_planCode_fkey";
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_planCode_fkey";

ALTER TABLE "Plan" ALTER COLUMN "code" TYPE TEXT USING "code"::text;
ALTER TABLE "Tenant" ALTER COLUMN "planCode" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "planCode" TYPE TEXT USING "planCode"::text;
ALTER TABLE "Tenant" ALTER COLUMN "planCode" SET DEFAULT 'PROFESSIONAL';
ALTER TABLE "Subscription" ALTER COLUMN "planCode" TYPE TEXT USING "planCode"::text;
ALTER TABLE "SubscriptionGrant" ALTER COLUMN "planCode" TYPE TEXT USING "planCode"::text;
ALTER TABLE "SubscriptionGrant" ALTER COLUMN "previousPlanCode" TYPE TEXT USING "previousPlanCode"::text;

DROP TYPE "PlanCode";

-- Kod biçimi: büyük harf, rakam ve alt çizgi (ör. PRO_YILLIK).
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_code_format" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,31}$');

ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionGrant" ADD CONSTRAINT "SubscriptionGrant_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- SaaS sahibi yeni paket ekleyebilir; paket silme yetkisi verilmez (pasife alınır).
GRANT INSERT ON "Plan" TO app_platform;
