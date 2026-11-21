-- TCMB döviz satış kuru: otomatik kur güncellemesi (yalnız ekleme)
ALTER TABLE "AiBillingSettings" ADD COLUMN "fxAuto" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AiBillingSettings" ADD COLUMN "fxRateDate" DATE;

CREATE TABLE "FxRate" (
    "currency" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "forexSelling" DECIMAL(12,4) NOT NULL,
    "bulletinNo" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("currency","date"),
    CONSTRAINT "FxRate_values" CHECK ("forexSelling" > 0 AND "currency" ~ '^[A-Z]{3}$')
);

GRANT SELECT, INSERT, UPDATE ON "FxRate" TO app_platform;
