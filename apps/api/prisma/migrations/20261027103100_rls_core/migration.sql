-- =====================================================================
-- Çok kiracılı güvenlik: veritabanı rolleri ve Row Level Security
-- =====================================================================
-- app_tenant      : uygulamanın işletme (tenant) istekleri için kullandığı rol.
--               RLS'yi ATLAYAMAZ. Her işlem "app.tenant_id" ayarıyla yapılır.
-- app_platform : SaaS sahibi paneli ve giriş işlemleri için ayrı rol (BYPASSRLS).
-- Roller NOLOGIN oluşturulur; parolalar ortama göre ayrıca atanır
-- (yerelde: scripts/dev-db-roles.sql).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_tenant, app_platform;

-- Geçerli kiracı: ayar yoksa veya boşsa NULL döner => hiçbir satır görünmez (fail-closed).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

GRANT EXECUTE ON FUNCTION app_current_tenant(), app_current_user() TO app_tenant, app_platform;

-- ---------------------------------------------------------------------
-- Tenant: işletme yalnızca kendi kaydını görür ve güncelleyebilir.
-- ---------------------------------------------------------------------
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON "Tenant"
  USING ("id" = app_current_tenant())
  WITH CHECK ("id" = app_current_tenant());
GRANT SELECT, UPDATE ON "Tenant" TO app_tenant;

-- ---------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------
ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Membership"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON "Membership" TO app_tenant;

-- ---------------------------------------------------------------------
-- User (global): işletme yalnızca kendi üyelerini görebilir.
-- Kullanıcı ekleme/parola işlemleri platform rolüyle yapılır.
-- ---------------------------------------------------------------------
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_visible_to_tenant ON "User" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."userId" = "User"."id" AND m."tenantId" = app_current_tenant()
  ));
GRANT SELECT ("id", "email", "fullName", "phone", "isActive", "createdAt") ON "User" TO app_tenant;

-- ---------------------------------------------------------------------
-- AuditLog: yalnızca ekleme ve okuma. Değiştirme/silme yetkisi yok.
-- ---------------------------------------------------------------------
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());
GRANT SELECT, INSERT ON "AuditLog" TO app_tenant;
GRANT SELECT, INSERT ON "AuditLog" TO app_platform;

-- Platform rolü: tüm tablolarda tam yetki (AuditLog hariç, yukarıda).
GRANT SELECT, INSERT, UPDATE, DELETE ON "Tenant", "User", "Membership" TO app_platform;
