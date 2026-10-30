-- Paket fiyat sürümleri (fiyat geçmişi), Owner onayı ve abonelik fiyat kilidi.
-- Yalnız ekleme yapar: mevcut satırlar değiştirilmez. Eski Plan.monthlyPrice/yearlyPrice sütunları
-- korunur ama artık kullanılmaz; onaylı fiyat sürümü olmayan paket sitede fiyatsız görünür.

-- CreateEnum
CREATE TYPE "PlanPriceStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');
CREATE TYPE "PlanPriceRenewalPolicy" AS ENUM ('KEEP_EXISTING', 'APPLY_ON_RENEWAL');

-- Plan: açıklama, görünürlük, kullanım sınırları (null = sınırsız)
ALTER TABLE "Plan" ADD COLUMN "description" TEXT,
ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "maxCustomers" INTEGER,
ADD COLUMN "maxMonthlyAppointments" INTEGER;
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_usage_limits" CHECK (("maxCustomers" IS NULL OR "maxCustomers" > 0) AND ("maxMonthlyAppointments" IS NULL OR "maxMonthlyAppointments" > 0));

-- CreateTable
CREATE TABLE "PlanPrice" (
    "id" UUID NOT NULL,
    "planCode" TEXT NOT NULL,
    "version" INTEGER,
    "monthlyPrice" DECIMAL(12,2) NOT NULL,
    "yearlyPrice" DECIMAL(12,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "renewalPolicy" "PlanPriceRenewalPolicy" NOT NULL,
    "renewalsFrom" TIMESTAMP(3),
    "status" "PlanPriceStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "PlanPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanPrice_planCode_version_key" ON "PlanPrice"("planCode", "version");
CREATE INDEX "PlanPrice_planCode_status_idx" ON "PlanPrice"("planCode", "status");

ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_planCode_fkey" FOREIGN KEY ("planCode") REFERENCES "Plan"("code") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_amounts" CHECK ("monthlyPrice" >= 0 AND "yearlyPrice" >= 0 AND "vatRate" >= 0 AND "vatRate" <= 100);
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_renewal" CHECK (
  ("renewalPolicy" = 'KEEP_EXISTING' AND "renewalsFrom" IS NULL) OR
  ("renewalPolicy" = 'APPLY_ON_RENEWAL' AND "renewalsFrom" IS NOT NULL AND "renewalsFrom" >= "effectiveFrom"));
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_state" CHECK (
  ("status" = 'DRAFT' AND "version" IS NULL AND "approvedAt" IS NULL) OR
  ("status" = 'APPROVED' AND "version" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "effectiveFrom" >= "approvedAt") OR
  ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL));

-- Onaylanan fiyat değiştirilemez ve silinemez; yalnız yürürlüğe girmeden ve hiçbir aboneliğe bağlanmadan iptal edilebilir.
CREATE FUNCTION plan_price_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fiyat sürümü silinemez' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."planCode" <> OLD."planCode" THEN
    RAISE EXCEPTION 'Fiyat sürümünün paketi değiştirilemez' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'İptal edilmiş fiyat sürümü değiştirilemez' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'APPROVED' THEN
    IF NEW."status" <> 'CANCELLED'
       OR NEW."monthlyPrice" <> OLD."monthlyPrice" OR NEW."yearlyPrice" <> OLD."yearlyPrice" OR NEW."vatRate" <> OLD."vatRate"
       OR NEW."effectiveFrom" <> OLD."effectiveFrom" OR NEW."renewalPolicy" <> OLD."renewalPolicy"
       OR NEW."renewalsFrom" IS DISTINCT FROM OLD."renewalsFrom" OR NEW."version" IS DISTINCT FROM OLD."version"
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById" THEN
      RAISE EXCEPTION 'Onaylı fiyat sürümü değiştirilemez' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."effectiveFrom" <= now() THEN
      RAISE EXCEPTION 'Yürürlüğe girmiş fiyat sürümü iptal edilemez' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "Subscription" s WHERE s."planPriceId" = OLD."id") THEN
      RAISE EXCEPTION 'Aboneliğe bağlı fiyat sürümü iptal edilemez' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_price_guard BEFORE UPDATE OR DELETE ON "PlanPrice" FOR EACH ROW EXECUTE FUNCTION plan_price_guard();

-- Abonelik fiyat kilidi (mevcut aboneliklerde boş kalır)
ALTER TABLE "Subscription" ADD COLUMN "planPriceId" UUID,
ADD COLUMN "priceAmount" DECIMAL(12,2),
ADD COLUMN "vatRate" DECIMAL(5,2);
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planPriceId_fkey" FOREIGN KEY ("planPriceId") REFERENCES "PlanPrice"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_price_lock" CHECK (
  ("planPriceId" IS NULL OR ("priceAmount" IS NOT NULL AND "vatRate" IS NOT NULL)) AND ("priceAmount" IS NULL OR "priceAmount" >= 0));
CREATE INDEX "Subscription_planPriceId_idx" ON "Subscription"("planPriceId");

-- Tahsilatta KDV hariç tutar ve oran
ALTER TABLE "SubscriptionPayment" ADD COLUMN "netAmount" DECIMAL(12,2),
ADD COLUMN "vatRate" DECIMAL(5,2);

-- Fiyat sürümleri yalnız SaaS sahibi rolünce okunur/yazılır (silme yetkisi yok); işletme rolü erişemez.
GRANT SELECT, INSERT, UPDATE ON "PlanPrice" TO app_platform;
