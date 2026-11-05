-- CreateEnum
CREATE TYPE "TrialApplicationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TrialApplication" (
    "id" UUID NOT NULL,
    "status" "TrialApplicationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "businessName" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT,
    "staffCount" INTEGER,
    "planCode" TEXT,
    "note" TEXT,
    "kvkkNoticeVersion" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" UUID,
    "rejectReason" TEXT,
    "tenantId" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrialApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrialApplication_tokenHash_key" ON "TrialApplication"("tokenHash");

-- CreateIndex
CREATE INDEX "TrialApplication_status_createdAt_idx" ON "TrialApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TrialApplication_email_idx" ON "TrialApplication"("email");

-- CreateIndex
CREATE INDEX "TrialApplication_phone_idx" ON "TrialApplication"("phone");

-- CreateIndex
CREATE INDEX "TrialApplication_expiresAt_idx" ON "TrialApplication"("expiresAt");

-- AddForeignKey
ALTER TABLE "TrialApplication" ADD CONSTRAINT "TrialApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Telefon biçimi (+90 ve 10 hane), kısa alanlar
ALTER TABLE "TrialApplication" ADD CONSTRAINT "TrialApplication_phone_format" CHECK ("phone" ~ '^\+90[0-9]{10}$');
ALTER TABLE "TrialApplication" ADD CONSTRAINT "TrialApplication_staff_range" CHECK ("staffCount" IS NULL OR "staffCount" BETWEEN 1 AND 500);
-- Onay/ret kararı verilmiş başvuruda karar zamanı zorunlu; onaylıda işletme bağlantısı (işletme silinirse NULL kalabilir)
ALTER TABLE "TrialApplication" ADD CONSTRAINT "TrialApplication_decided" CHECK ("status" IN ('UNVERIFIED', 'PENDING') OR "decidedAt" IS NOT NULL);

-- Aynı e-postayla aynı anda yalnızca bir açık (doğrulanmamış/bekleyen) başvuru olabilir
CREATE UNIQUE INDEX "TrialApplication_open_email_key" ON "TrialApplication"("email") WHERE "status" IN ('UNVERIFIED', 'PENDING');

-- Yetkiler: başvurular yalnızca platform rolüyle işlenir; işletme rolü erişemez.
REVOKE ALL ON "TrialApplication" FROM app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "TrialApplication" TO app_platform;
