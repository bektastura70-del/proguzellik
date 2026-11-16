-- Mahalle listeden seçilir (İçişleri Bakanlığı mahalle listesi, src/directory/tr-neighborhoods.ts). Yalnızca ekleme:
-- boş (NULL) bir sütun; mevcut veri değişmez. "Tenant"."neighborhood" seçilen mahallenin adını (adreste görünen) tutar.
ALTER TABLE "SalonListing" ADD COLUMN "neighborhoodSlug" TEXT;
ALTER TABLE "SalonListing" ADD CONSTRAINT salon_listing_neighborhood CHECK (
  "neighborhoodSlug" IS NULL OR ("districtCode" IS NOT NULL AND char_length("neighborhoodSlug") <= 120));
GRANT INSERT ("neighborhoodSlug") ON "SalonListing" TO app_tenant;
GRANT UPDATE ("neighborhoodSlug") ON "SalonListing" TO app_tenant;
