-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('ACCRUAL', 'ACCRUAL_CANCEL', 'PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "LedgerPaymentMethod" AS ENUM ('BANK_TRANSFER', 'CARD', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('DRAFT', 'RECORDED', 'ISSUED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PlatformCompany" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "legalName" TEXT,
    "address" TEXT,
    "taxNumber" TEXT,
    "taxOffice" TEXT,
    "iban" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "vatRate" DECIMAL(5,2),
    "pricesIncludeVat" BOOLEAN,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 7,
    "invoiceNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PlatformCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantBillingProfile" (
    "tenantId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxNumber" TEXT,
    "taxOffice" TEXT,
    "address" TEXT,
    "email" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBillingProfile_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "PlatformLedgerEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "subscriptionId" UUID,
    "relatedEntryId" UUID,
    "method" "LedgerPaymentMethod",
    "reference" TEXT,
    "requestId" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "draftNo" TEXT NOT NULL,
    "officialNumber" TEXT,
    "issueDate" TIMESTAMP(3),
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "vatRate" DECIMAL(5,2) NOT NULL,
    "pricesIncludeVat" BOOLEAN NOT NULL,
    "netTotal" DECIMAL(12,2) NOT NULL,
    "vatTotal" DECIMAL(12,2) NOT NULL,
    "grossTotal" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "accrualId" UUID,
    "provider" TEXT,
    "providerRef" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoiceLine" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "vatAmount" DECIMAL(12,2) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformLedgerEntry_requestId_key" ON "PlatformLedgerEntry"("requestId");

-- CreateIndex
CREATE INDEX "PlatformLedgerEntry_tenantId_occurredAt_idx" ON "PlatformLedgerEntry"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "PlatformLedgerEntry_relatedEntryId_idx" ON "PlatformLedgerEntry"("relatedEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_draftNo_key" ON "PlatformInvoice"("draftNo");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_officialNumber_key" ON "PlatformInvoice"("officialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_accrualId_key" ON "PlatformInvoice"("accrualId");

-- CreateIndex
CREATE INDEX "PlatformInvoice_tenantId_createdAt_idx" ON "PlatformInvoice"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantBillingProfile" ADD CONSTRAINT "TenantBillingProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformLedgerEntry" ADD CONSTRAINT "PlatformLedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformLedgerEntry" ADD CONSTRAINT "PlatformLedgerEntry_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformLedgerEntry" ADD CONSTRAINT "PlatformLedgerEntry_relatedEntryId_fkey" FOREIGN KEY ("relatedEntryId") REFERENCES "PlatformLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_accrualId_fkey" FOREIGN KEY ("accrualId") REFERENCES "PlatformLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoiceLine" ADD CONSTRAINT "PlatformInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PlatformInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Güvenlik ve bütünlük: SaaS sahibi muhasebesi işletme muhasebesinden ayrıdır.
-- =====================================================================

-- Tek satırlık şirket bilgisi.
ALTER TABLE "PlatformCompany" ADD CONSTRAINT "PlatformCompany_singleton" CHECK ("id" = 1);
ALTER TABLE "PlatformCompany" ADD CONSTRAINT "PlatformCompany_vat_range" CHECK ("vatRate" IS NULL OR ("vatRate" >= 0 AND "vatRate" <= 100));
ALTER TABLE "PlatformCompany" ADD CONSTRAINT "PlatformCompany_term" CHECK ("paymentTermDays" BETWEEN 0 AND 365);

-- Cari hesap tutarları pozitif; ilişki kuralları.
ALTER TABLE "PlatformLedgerEntry" ADD CONSTRAINT "PlatformLedgerEntry_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PlatformLedgerEntry" ADD CONSTRAINT "PlatformLedgerEntry_relation_rules" CHECK (
  ("type" = 'ACCRUAL' AND "relatedEntryId" IS NULL AND "method" IS NULL) OR
  ("type" = 'ACCRUAL_CANCEL' AND "relatedEntryId" IS NOT NULL AND "method" IS NULL) OR
  ("type" = 'PAYMENT' AND "method" IS NOT NULL) OR
  ("type" = 'REFUND' AND "relatedEntryId" IS NOT NULL AND "method" IS NOT NULL)
);

-- Cari hesap yalnızca eklenir: güncelleme ve silme veritabanında engellenir.
CREATE OR REPLACE FUNCTION platform_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Cari hesap kaydı değiştirilemez veya silinemez; ters kayıt girin' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER platform_ledger_append_only
  BEFORE UPDATE OR DELETE ON "PlatformLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION platform_ledger_append_only();

-- Manuel ücretsiz aboneliğe tahakkuk bağlanamaz (gelir kaydı oluşmaz).
CREATE OR REPLACE FUNCTION platform_ledger_no_complimentary() RETURNS trigger AS $$
BEGIN
  IF NEW."subscriptionId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Subscription" s WHERE s."id" = NEW."subscriptionId" AND (s."isComplimentary" OR s."tenantId" <> NEW."tenantId")
  ) THEN
    RAISE EXCEPTION 'Ücretsiz ya da başka işletmeye ait aboneliğe cari kayıt bağlanamaz' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."relatedEntryId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "PlatformLedgerEntry" r WHERE r."id" = NEW."relatedEntryId" AND r."tenantId" = NEW."tenantId" AND (
      (NEW."type" IN ('ACCRUAL_CANCEL', 'PAYMENT') AND r."type" = 'ACCRUAL') OR (NEW."type" = 'REFUND' AND r."type" = 'PAYMENT')
    )
  ) THEN
    RAISE EXCEPTION 'İlişkili cari kayıt uygun değil' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER platform_ledger_no_complimentary
  BEFORE INSERT ON "PlatformLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION platform_ledger_no_complimentary();

-- Fatura: tutarlar tutarlı; taslak dışındaki fatura içeriği değiştirilemez, silinemez.
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_totals" CHECK ("grossTotal" = "netTotal" + "vatTotal" AND "netTotal" >= 0 AND "vatTotal" >= 0);
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_official_number" CHECK (("status" IN ('RECORDED', 'ISSUED')) = ("officialNumber" IS NOT NULL) OR ("status" = 'CANCELLED'));
ALTER TABLE "PlatformInvoiceLine" ADD CONSTRAINT "PlatformInvoiceLine_amounts" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "grossAmount" = "netAmount" + "vatAmount");

CREATE OR REPLACE FUNCTION platform_invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fatura kaydı silinemez; iptal edin' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'İptal edilmiş fatura değiştirilemez' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('RECORDED', 'ISSUED') AND (
    NEW."netTotal" <> OLD."netTotal" OR NEW."vatTotal" <> OLD."vatTotal" OR NEW."grossTotal" <> OLD."grossTotal" OR
    NEW."buyer" <> OLD."buyer" OR NEW."seller" <> OLD."seller" OR NEW."officialNumber" IS DISTINCT FROM OLD."officialNumber" OR
    NEW."tenantId" <> OLD."tenantId" OR NEW."status" NOT IN (OLD."status", 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'Kesinleşmiş fatura değiştirilemez' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER platform_invoice_guard
  BEFORE UPDATE OR DELETE ON "PlatformInvoice"
  FOR EACH ROW EXECUTE FUNCTION platform_invoice_guard();

CREATE OR REPLACE FUNCTION platform_invoice_line_guard() RETURNS trigger AS $$
DECLARE inv_status TEXT;
BEGIN
  SELECT "status" INTO inv_status FROM "PlatformInvoice" WHERE "id" = COALESCE(NEW."invoiceId", OLD."invoiceId");
  IF inv_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Yalnızca taslak faturanın kalemleri değiştirilebilir' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER platform_invoice_line_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "PlatformInvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION platform_invoice_line_guard();

-- Taslak numarası sırası (resmî fatura numarası değildir).
CREATE SEQUENCE platform_invoice_draft_seq;

-- Yetkiler: işletme rolüne hiçbir yetki yok; platform rolü cari hesabı yalnızca ekler/okur.
REVOKE ALL ON "PlatformCompany", "TenantBillingProfile", "PlatformLedgerEntry", "PlatformInvoice", "PlatformInvoiceLine" FROM app_tenant;
GRANT SELECT, INSERT, UPDATE ON "PlatformCompany", "TenantBillingProfile" TO app_platform;
GRANT SELECT, INSERT ON "PlatformLedgerEntry" TO app_platform;
GRANT SELECT, INSERT, UPDATE ON "PlatformInvoice" TO app_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformInvoiceLine" TO app_platform;
GRANT USAGE ON SEQUENCE platform_invoice_draft_seq TO app_platform;

-- Kiracı bağlamındaki sorgular için ek savunma (işletme rolünün zaten yetkisi yok).
ALTER TABLE "TenantBillingProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantBillingProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantBillingProfile" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "PlatformLedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformLedgerEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PlatformLedgerEntry" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
ALTER TABLE "PlatformInvoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformInvoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PlatformInvoice" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
