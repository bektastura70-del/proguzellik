-- Yenilenme hatırlatması: SaaS sahibinin işletme başına izni (pilot). Varsayılan kapalı.
-- app_tenant bu sütunu değiştiremez (Tenant tablosunda sütun bazlı UPDATE yetkisi; bu sütun eklenmedi).
ALTER TABLE "Tenant" ADD COLUMN "renewalRemindersAllowed" BOOLEAN NOT NULL DEFAULT false;
