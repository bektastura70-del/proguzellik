-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "vatRate" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "ProductSale" ADD COLUMN     "appointmentId" UUID,
ADD COLUMN     "vatTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductSaleItem" ADD COLUMN     "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vatRate" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "ProductSaleReturnLine" ADD COLUMN     "vatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "lowStockEmailEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_tenantId_appointmentId_fkey" FOREIGN KEY ("tenantId", "appointmentId") REFERENCES "Appointment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Veri bütünlüğü
ALTER TABLE "Product" ADD CONSTRAINT product_vat_rate_range CHECK ("vatRate" IS NULL OR "vatRate" BETWEEN 0 AND 100);
ALTER TABLE "ProductSaleItem" ADD CONSTRAINT product_sale_item_vat_valid CHECK (("vatRate" IS NULL OR "vatRate" BETWEEN 0 AND 100) AND "vatAmount" >= 0 AND "vatAmount" <= "lineTotal");
ALTER TABLE "ProductSale" ADD CONSTRAINT product_sale_vat_valid CHECK ("vatTotal" >= 0 AND "vatTotal" <= "total");
ALTER TABLE "ProductSaleReturnLine" ADD CONSTRAINT product_sale_return_line_vat_valid CHECK ("vatAmount" >= 0 AND "vatAmount" <= "amount");

-- İşletme kendi kritik stok e-postası ayarını değiştirebilir
GRANT UPDATE ("lowStockEmailEnabled") ON "Tenant" TO app_tenant;
