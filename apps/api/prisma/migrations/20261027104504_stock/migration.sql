-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('RETAIL', 'CONSUMABLE');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT', 'ADJUST', 'CONSUME', 'SALE');

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'adet',
    "kind" "ProductKind" NOT NULL DEFAULT 'CONSUMABLE',
    "stockQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "costPrice" DECIMAL(12,2),
    "salePrice" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "note" TEXT,
    "appointmentId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceConsumable" (
    "tenantId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "ServiceConsumable_pkey" PRIMARY KEY ("serviceId","productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_id_key" ON "Product"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_productId_createdAt_idx" ON "StockMovement"("tenantId", "productId", "createdAt");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceConsumable" ADD CONSTRAINT "ServiceConsumable_tenantId_serviceId_fkey" FOREIGN KEY ("tenantId", "serviceId") REFERENCES "Service"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceConsumable" ADD CONSTRAINT "ServiceConsumable_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

SELECT app_secure_tenant_table(t) FROM unnest(ARRAY['Product', 'StockMovement', 'ServiceConsumable']) AS t;
REVOKE UPDATE, DELETE ON "StockMovement" FROM app_tenant;
ALTER TABLE "StockMovement" ADD CONSTRAINT stock_qty_nonzero CHECK ("qty" <> 0);
ALTER TABLE "ServiceConsumable" ADD CONSTRAINT consumable_qty_positive CHECK ("qty" > 0);
ALTER TABLE "Product" ADD CONSTRAINT product_prices_nonneg CHECK (coalesce("costPrice", 0) >= 0 AND coalesce("salePrice", 0) >= 0 AND "minQty" >= 0);
