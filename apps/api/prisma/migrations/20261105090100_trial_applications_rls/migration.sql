-- Deneme başvurusu tablosu işletme rolüne zaten kapalı (yetki yok). Ek savunma: tenantId sütunu olan her tablo gibi
-- RLS açık ve zorunlu; platform rolü (BYPASSRLS) etkilenmez.
ALTER TABLE "TrialApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrialApplication" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TrialApplication" USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
