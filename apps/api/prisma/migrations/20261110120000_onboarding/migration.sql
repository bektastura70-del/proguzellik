-- Başlangıç sihirbazı: işletme sahibi "sonra yaparım / gizle" dediğinde zaman damgası. Adım durumları mevcut verilerden hesaplanır.
ALTER TABLE "Tenant" ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);
GRANT UPDATE ("onboardingDismissedAt") ON "Tenant" TO app_tenant;
