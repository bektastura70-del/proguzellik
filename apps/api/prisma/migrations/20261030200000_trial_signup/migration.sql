-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('KVKK_NOTICE', 'TERMS', 'MARKETING');

-- CreateTable
CREATE TABLE "SignupRequest" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "kvkkNoticeVersion" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConsent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignupRequest_email_key" ON "SignupRequest"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SignupRequest_tokenHash_key" ON "SignupRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "SignupRequest_phone_idx" ON "SignupRequest"("phone");

-- CreateIndex
CREATE INDEX "SignupRequest_expiresAt_idx" ON "SignupRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "UserConsent_userId_type_createdAt_idx" ON "UserConsent"("userId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "UserConsent" ADD CONSTRAINT "UserConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Telefon biçimi (+90 ve 10 hane)
ALTER TABLE "SignupRequest" ADD CONSTRAINT "SignupRequest_phone_format" CHECK ("phone" ~ '^\+90[0-9]{10}$');

-- Onay kayıtları değiştirilmez (kullanıcı silinirse birlikte silinir)
CREATE OR REPLACE FUNCTION user_consent_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'UserConsent kayıtları değiştirilemez';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_consent_no_update BEFORE UPDATE ON "UserConsent" FOR EACH ROW EXECUTE FUNCTION user_consent_no_update();

-- Yetkiler: kayıt akışı yalnızca platform rolüyle çalışır; işletme rolü bu tablolara erişemez.
REVOKE ALL ON "SignupRequest", "UserConsent" FROM app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SignupRequest" TO app_platform;
GRANT SELECT, INSERT, DELETE ON "UserConsent" TO app_platform;
