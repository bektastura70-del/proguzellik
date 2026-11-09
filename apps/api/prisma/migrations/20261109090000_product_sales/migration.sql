-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN';

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "productCommissionRate" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "productSaleId" UUID;

-- CreateTable
CREATE TABLE "ProductSale" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID,
    "staffId" UUID,
    "financeTransactionId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSaleItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2),
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ProductSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSaleReturn" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "refundTransactionId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSaleReturnLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "returnId" UUID NOT NULL,
    "saleItemId" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "restocked" BOOLEAN NOT NULL,

    CONSTRAINT "ProductSaleReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductSale_tenantId_occurredAt_idx" ON "ProductSale"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "ProductSale_tenantId_staffId_occurredAt_idx" ON "ProductSale"("tenantId", "staffId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSale_tenantId_id_key" ON "ProductSale"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSale_tenantId_financeTransactionId_key" ON "ProductSale"("tenantId", "financeTransactionId");

-- CreateIndex
CREATE INDEX "ProductSaleItem_tenantId_saleId_idx" ON "ProductSaleItem"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "ProductSaleItem_tenantId_productId_idx" ON "ProductSaleItem"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSaleItem_tenantId_id_key" ON "ProductSaleItem"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ProductSaleReturn_tenantId_saleId_idx" ON "ProductSaleReturn"("tenantId", "saleId");

-- CreateIndex
CREATE INDEX "ProductSaleReturn_tenantId_createdAt_idx" ON "ProductSaleReturn"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSaleReturn_tenantId_id_key" ON "ProductSaleReturn"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ProductSaleReturnLine_tenantId_saleItemId_idx" ON "ProductSaleReturnLine"("tenantId", "saleItemId");

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "StaffMember"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSale" ADD CONSTRAINT "ProductSale_tenantId_financeTransactionId_fkey" FOREIGN KEY ("tenantId", "financeTransactionId") REFERENCES "FinanceTransaction"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSaleItem" ADD CONSTRAINT "ProductSaleItem_tenantId_saleId_fkey" FOREIGN KEY ("tenantId", "saleId") REFERENCES "ProductSale"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSaleItem" ADD CONSTRAINT "ProductSaleItem_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSaleReturn" ADD CONSTRAINT "ProductSaleReturn_tenantId_saleId_fkey" FOREIGN KEY ("tenantId", "saleId") REFERENCES "ProductSale"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSaleReturn" ADD CONSTRAINT "ProductSaleReturn_tenantId_refundTransactionId_fkey" FOREIGN KEY ("tenantId", "refundTransactionId") REFERENCES "FinanceTransaction"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSaleReturnLine" ADD CONSTRAINT "ProductSaleReturnLine_tenantId_returnId_fkey" FOREIGN KEY ("tenantId", "returnId") REFERENCES "ProductSaleReturn"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSaleReturnLine" ADD CONSTRAINT "ProductSaleReturnLine_tenantId_saleItemId_fkey" FOREIGN KEY ("tenantId", "saleItemId") REFERENCES "ProductSaleItem"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Stok hareketinden satış fişine bağlantı
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_productSaleId_fkey" FOREIGN KEY ("tenantId", "productSaleId") REFERENCES "ProductSale"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kiracı yalıtımı; fiş, satır ve iadeler değiştirilemez/silinemez (yalnızca ekleme)
SELECT app_secure_tenant_table(t) FROM unnest(ARRAY['ProductSale', 'ProductSaleItem', 'ProductSaleReturn', 'ProductSaleReturnLine']) AS t;
REVOKE UPDATE, DELETE ON "ProductSale", "ProductSaleItem", "ProductSaleReturn", "ProductSaleReturnLine" FROM app_tenant;

-- Veri bütünlüğü
ALTER TABLE "StaffMember" ADD CONSTRAINT staff_product_commission_range CHECK ("productCommissionRate" BETWEEN 0 AND 100);
ALTER TABLE "ProductSale" ADD CONSTRAINT product_sale_total_nonneg CHECK ("total" >= 0);
ALTER TABLE "ProductSaleItem" ADD CONSTRAINT product_sale_item_valid CHECK ("qty" > 0 AND "unitPrice" >= 0 AND "lineTotal" >= 0 AND coalesce("unitCost", 0) >= 0);
ALTER TABLE "ProductSaleReturn" ADD CONSTRAINT product_sale_return_amount_nonneg CHECK ("amount" >= 0);
ALTER TABLE "ProductSaleReturnLine" ADD CONSTRAINT product_sale_return_line_valid CHECK ("qty" > 0 AND "amount" >= 0);
