-- Yenilenme hatırlatması (varsayılan kapalı). Yalnızca mevcut tablolara sütun eklenir; RLS politikaları aynen geçerlidir.
ALTER TABLE "Tenant" ADD COLUMN "renewalRemindersEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "renewalRemindersOptOutAt" TIMESTAMP(3);
ALTER TABLE "Service" ADD COLUMN "renewalRemindDaysBefore" INTEGER;
ALTER TABLE "Service" ADD CONSTRAINT "Service_renewalRemindDaysBefore_check"
  CHECK ("renewalRemindDaysBefore" IS NULL OR ("renewalRemindDaysBefore" >= 1 AND "renewalRemindDaysBefore" <= 60));

-- İşletme kendi ayarını değiştirebilir (Tenant tablosunda sütun bazlı yetki kullanılıyor)
GRANT UPDATE ("renewalRemindersEnabled") ON "Tenant" TO app_tenant;
