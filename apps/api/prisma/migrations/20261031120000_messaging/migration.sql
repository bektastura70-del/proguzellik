-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('WHATSAPP', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('DRAFT', 'CONNECTED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('CUSTOMER', 'AI', 'STAFF', 'SYSTEM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingSource" ADD VALUE 'WHATSAPP';
ALTER TYPE "BookingSource" ADD VALUE 'INSTAGRAM';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "campaignId" UUID,
ADD COLUMN     "customerId" UUID,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'SERVICE';

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "rebookAfterDays" INTEGER;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "packageReminderDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'DRAFT',
    "externalId" TEXT NOT NULL,
    "businessAccountId" TEXT,
    "displayName" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL,
    "appSecretEnc" TEXT NOT NULL,
    "verifyTokenEnc" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "webhookVerifiedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastError" TEXT,
    "aiAutoReply" BOOLEAN NOT NULL DEFAULT false,
    "aiDataConsentAt" TIMESTAMP(3),
    "aiDataConsentBy" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "customerId" UUID,
    "mode" "ConversationMode" NOT NULL DEFAULT 'AI',
    "handoffReason" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unread" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "text" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "staffUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelConnection_channel_externalId_idx" ON "ChannelConnection"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_tenantId_id_key" ON "ChannelConnection"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_tenantId_channel_key" ON "ChannelConnection"("tenantId", "channel");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_lastMessageAt_idx" ON "Conversation"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_id_key" ON "Conversation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_connectionId_externalUserId_key" ON "Conversation"("connectionId", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_providerMessageId_key" ON "ConversationMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "ConversationMessage_tenantId_conversationId_createdAt_idx" ON "ConversationMessage"("tenantId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_isActive_idx" ON "Campaign"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_dedupeKey_key" ON "Notification"("tenantId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_tenantId_connectionId_fkey" FOREIGN KEY ("tenantId", "connectionId") REFERENCES "ChannelConnection"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_tenantId_conversationId_fkey" FOREIGN KEY ("tenantId", "conversationId") REFERENCES "Conversation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Bir Meta hesabı (numara / Instagram hesabı) aynı anda yalnızca bir işletmeye bağlı olabilir.
CREATE UNIQUE INDEX "ChannelConnection_connected_external_key" ON "ChannelConnection"("channel", "externalId") WHERE "status" = 'CONNECTED';

-- Kiracı izolasyonu (RLS); platform rolü yalnızca okur (webhook yönlendirmesi, işçi).
SELECT app_secure_tenant_table(t) FROM unnest(ARRAY['ChannelConnection', 'Conversation', 'ConversationMessage', 'Campaign']) AS t;
-- Meta teslim durumları (webhook) giden mesaj kaydını günceller.
GRANT UPDATE ("status", "error") ON "ConversationMessage" TO app_platform;
