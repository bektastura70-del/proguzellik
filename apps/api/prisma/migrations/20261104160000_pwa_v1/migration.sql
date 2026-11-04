-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "portalIdentityId" UUID;

-- CreateTable
CREATE TABLE "TenantPwaSettings" (
    "tenantId" UUID NOT NULL,
    "businessPwaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "customerPwaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "customerBookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webPushEnabled" BOOLEAN NOT NULL DEFAULT false,
    "customerSessionTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "flagsUpdatedById" UUID,
    "flagsUpdatedAt" TIMESTAMP(3),
    "cancelMinHours" INTEGER NOT NULL DEFAULT 2,
    "rescheduleMinHours" INTEGER NOT NULL DEFAULT 2,
    "allowCustomerCancel" BOOLEAN NOT NULL DEFAULT true,
    "allowCustomerReschedule" BOOLEAN NOT NULL DEFAULT true,
    "appName" TEXT,
    "shortName" TEXT,
    "description" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "logoAssetId" UUID,
    "iconAssetId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantPwaSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "TenantAsset" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerIdentity" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "notifyAppointments" BOOLEAN NOT NULL DEFAULT true,
    "notifyReminders" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOtp" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "destination" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPortalSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "audience" TEXT NOT NULL,
    "userId" UUID,
    "identityId" UUID,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "newAppointments" BOOLEAN NOT NULL DEFAULT true,
    "cancellations" BOOLEAN NOT NULL DEFAULT true,
    "changes" BOOLEAN NOT NULL DEFAULT true,
    "assignments" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("tenantId","userId")
);

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "audience" TEXT NOT NULL,
    "userId" UUID,
    "identityId" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "appointmentId" UUID,
    "readAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantAsset_tenantId_kind_idx" ON "TenantAsset"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerIdentity_tenantId_email_key" ON "CustomerIdentity"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerIdentity_tenantId_id_key" ON "CustomerIdentity"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CustomerOtp_tenantId_destination_createdAt_idx" ON "CustomerOtp"("tenantId", "destination", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPortalSession_tokenHash_key" ON "CustomerPortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CustomerPortalSession_tenantId_identityId_idx" ON "CustomerPortalSession"("tenantId", "identityId");

-- CreateIndex
CREATE INDEX "PushSubscription_tenantId_userId_idx" ON "PushSubscription"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "PushSubscription_tenantId_identityId_idx" ON "PushSubscription"("tenantId", "identityId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_tenantId_endpoint_key" ON "PushSubscription"("tenantId", "endpoint");

-- CreateIndex
CREATE INDEX "InAppNotification_tenantId_userId_createdAt_idx" ON "InAppNotification"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "InAppNotification_tenantId_identityId_createdAt_idx" ON "InAppNotification"("tenantId", "identityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InAppNotification_tenantId_dedupeKey_key" ON "InAppNotification"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_portalIdentityId_idx" ON "Appointment"("tenantId", "portalIdentityId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_tenantId_idempotencyKey_key" ON "Appointment"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "TenantPwaSettings" ADD CONSTRAINT "TenantPwaSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantAsset" ADD CONSTRAINT "TenantAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerIdentity" ADD CONSTRAINT "CustomerIdentity_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPortalSession" ADD CONSTRAINT "CustomerPortalSession_tenantId_identityId_fkey" FOREIGN KEY ("tenantId", "identityId") REFERENCES "CustomerIdentity"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_tenantId_identityId_fkey" FOREIGN KEY ("tenantId", "identityId") REFERENCES "CustomerIdentity"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

