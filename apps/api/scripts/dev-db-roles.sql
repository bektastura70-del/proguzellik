-- YALNIZCA YEREL GELİŞTİRME/TEST: uygulama rollerine giriş izni ve parola verir.
-- Üretimde parolalar gizli yönetimle atanmalıdır.
ALTER ROLE app_tenant LOGIN PASSWORD 'app_tenant_dev';
ALTER ROLE app_platform LOGIN PASSWORD 'app_platform_dev';
