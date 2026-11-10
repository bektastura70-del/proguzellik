-- ProGüzellik Meta uygulaması üzerinden (Embedded Signup) kurulan bağlantılar: uygulama sırrı ve webhook adresi
-- ortaktır (ortam değişkenlerinde), bağlantıya özel sır saklanmaz.
ALTER TABLE "ChannelConnection" ADD COLUMN "managed" BOOLEAN NOT NULL DEFAULT false;
-- Numaranın iki adımlı doğrulama PIN'i (Cloud API kaydında belirlenir), şifreli.
ALTER TABLE "ChannelConnection" ADD COLUMN "pinEnc" TEXT;
