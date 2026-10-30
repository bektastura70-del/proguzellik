-- Davetler artık yönetici/resepsiyon/personel rolleri için de kullanılır.
-- Önceki kural (işletme başına tek açık davet) yalnızca sahip (OWNER) davetine daraltılır;
-- ayrıca aynı işletmede aynı e-postaya birden fazla açık davet olamaz. Mevcut satırlar değişmez.
DROP INDEX IF EXISTS "TenantInvite_one_open_per_tenant";
CREATE UNIQUE INDEX "TenantInvite_one_open_owner_per_tenant" ON "TenantInvite"("tenantId") WHERE "status" IN ('PENDING_DELIVERY', 'SENT') AND "role" = 'OWNER';
CREATE UNIQUE INDEX "TenantInvite_one_open_per_email" ON "TenantInvite"("tenantId", "email") WHERE "status" IN ('PENDING_DELIVERY', 'SENT');
