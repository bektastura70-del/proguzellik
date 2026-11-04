-- =====================================================================
-- PWA V1.0: kiracı izolasyonu (RLS), yetkiler ve bütünlük kuralları
-- =====================================================================
SELECT app_secure_tenant_table(t) FROM unnest(ARRAY[
  'TenantPwaSettings', 'TenantAsset', 'CustomerIdentity', 'CustomerOtp', 'CustomerPortalSession',
  'PushSubscription', 'UserNotificationPreference', 'InAppNotification'
]) AS t;

-- Özellik bayraklarını yalnızca SaaS sahibi (platform rolü) değiştirir; işletme yalnız marka ve iptal/değişiklik kurallarını düzenler.
REVOKE INSERT, UPDATE, DELETE ON "TenantPwaSettings" FROM app_tenant;
GRANT INSERT ("tenantId", "cancelMinHours", "rescheduleMinHours", "allowCustomerCancel", "allowCustomerReschedule",
  "appName", "shortName", "description", "primaryColor", "secondaryColor", "logoAssetId", "iconAssetId", "updatedAt")
  ON "TenantPwaSettings" TO app_tenant;
GRANT UPDATE ("cancelMinHours", "rescheduleMinHours", "allowCustomerCancel", "allowCustomerReschedule",
  "appName", "shortName", "description", "primaryColor", "secondaryColor", "logoAssetId", "iconAssetId", "updatedAt")
  ON "TenantPwaSettings" TO app_tenant;
GRANT INSERT, UPDATE ON "TenantPwaSettings" TO app_platform;

-- Push gönderim işçisi (platform rolü) yalnızca teslim durumu alanlarını günceller.
GRANT UPDATE ("failures", "lastSuccessAt", "revokedAt", "updatedAt") ON "PushSubscription" TO app_platform;
-- Yüklenen görsel değiştirilmez; yenisi eklenir.
REVOKE UPDATE ON "TenantAsset" FROM app_tenant;

ALTER TABLE "TenantPwaSettings" ADD CONSTRAINT pwa_colors_valid CHECK (
  ("primaryColor" IS NULL OR "primaryColor" ~ '^#[0-9a-fA-F]{6}$') AND ("secondaryColor" IS NULL OR "secondaryColor" ~ '^#[0-9a-fA-F]{6}$'));
ALTER TABLE "TenantPwaSettings" ADD CONSTRAINT pwa_hours_valid CHECK (
  "cancelMinHours" BETWEEN 0 AND 168 AND "rescheduleMinHours" BETWEEN 0 AND 168);
ALTER TABLE "TenantAsset" ADD CONSTRAINT asset_valid CHECK (
  "kind" IN ('LOGO', 'ICON') AND "mime" IN ('image/png', 'image/jpeg', 'image/webp') AND octet_length("bytes") <= 524288);
ALTER TABLE "CustomerIdentity" ADD CONSTRAINT identity_email_lower CHECK ("email" = lower("email"));
ALTER TABLE "CustomerOtp" ADD CONSTRAINT otp_channel_valid CHECK ("channel" IN ('EMAIL', 'SMS'));
ALTER TABLE "PushSubscription" ADD CONSTRAINT push_owner_valid CHECK (
  ("audience" = 'STAFF' AND "userId" IS NOT NULL AND "identityId" IS NULL) OR
  ("audience" = 'CUSTOMER' AND "identityId" IS NOT NULL AND "userId" IS NULL));
ALTER TABLE "PushSubscription" ADD CONSTRAINT push_endpoint_https CHECK ("endpoint" LIKE 'https://%');
ALTER TABLE "InAppNotification" ADD CONSTRAINT inapp_owner_valid CHECK (
  ("audience" = 'STAFF' AND "userId" IS NOT NULL AND "identityId" IS NULL) OR
  ("audience" = 'CUSTOMER' AND "identityId" IS NOT NULL AND "userId" IS NULL));
