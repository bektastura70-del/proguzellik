-- Salon tam adresi: mahalle (serbest metin) ve salon sayfasında ve rehberde isteğe bağlı (varsayılan kapalı) "Yol tarifi al".
-- Yalnızca ekleme: boş (NULL) bir sütun ve varsayılanı kapalı bir bayrak. Mevcut veri değişmez; eski sürüm bu sütunları okumaz.
ALTER TABLE "Tenant" ADD COLUMN "neighborhood" TEXT;
ALTER TABLE "Tenant" ADD CONSTRAINT tenant_neighborhood_len CHECK ("neighborhood" IS NULL OR char_length("neighborhood") <= 80);
GRANT UPDATE ("neighborhood") ON "Tenant" TO app_tenant;

ALTER TABLE "SalonListing" ADD COLUMN "showDirections" BOOLEAN NOT NULL DEFAULT false;
GRANT INSERT ("showDirections") ON "SalonListing" TO app_tenant;
GRANT UPDATE ("showDirections") ON "SalonListing" TO app_tenant;
