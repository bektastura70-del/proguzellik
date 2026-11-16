-- Mobil uygulama salon rehberi (il > ilçe > salon). Yalnızca ekleme: yeni tablo, mevcut veriye dokunmaz.
-- Geri dönüşte eski sürüm bu tabloyu okumaz; tablo boş/atıl kalır.
CREATE TABLE "SalonListing" (
    "tenantId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provinceCode" INTEGER,
    "districtCode" INTEGER,
    "showAddress" BOOLEAN NOT NULL DEFAULT false,
    "showPhone" BOOLEAN NOT NULL DEFAULT false,
    "enabledById" UUID,
    "enabledAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonListing_pkey" PRIMARY KEY ("tenantId")
);

CREATE INDEX "SalonListing_enabled_provinceCode_districtCode_idx" ON "SalonListing"("enabled", "provinceCode", "districtCode");

ALTER TABLE "SalonListing" ADD CONSTRAINT "SalonListing_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Kiracı izolasyonu: işletme yalnız kendi satırını görür.
SELECT app_secure_tenant_table('SalonListing');

-- İşletme listeden çıkarma (blocked*) alanlarını yazamaz; satırı silemez (kapatmak için enabled=false).
REVOKE INSERT, UPDATE, DELETE ON "SalonListing" FROM app_tenant;
GRANT INSERT ("tenantId", "enabled", "provinceCode", "districtCode", "showAddress", "showPhone", "enabledById", "enabledAt", "updatedAt")
  ON "SalonListing" TO app_tenant;
GRANT UPDATE ("enabled", "provinceCode", "districtCode", "showAddress", "showPhone", "enabledById", "enabledAt", "updatedAt")
  ON "SalonListing" TO app_tenant;
-- SaaS sahibi: listeden çıkarma / geri alma.
GRANT UPDATE ("blockedAt", "blockedReason", "updatedAt") ON "SalonListing" TO app_platform;

-- Açık listeleme il ve ilçe ister.
ALTER TABLE "SalonListing" ADD CONSTRAINT salon_listing_location CHECK (
  NOT "enabled" OR ("provinceCode" IS NOT NULL AND "provinceCode" BETWEEN 1 AND 81 AND "districtCode" IS NOT NULL));
ALTER TABLE "SalonListing" ADD CONSTRAINT salon_listing_reason CHECK (
  "blockedReason" IS NULL OR char_length("blockedReason") <= 300);
