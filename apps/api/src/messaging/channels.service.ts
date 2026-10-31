import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ChannelConnection, ChannelType, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { appUrl, loadEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { decrypt, deriveKeyHex, encrypt, randomToken } from "../security/crypto";
import { IgCreds, MetaApiError, MetaDisabledError, MetaGateway, WaCreds } from "./meta.gateway";
import { TEMPLATES } from "./templates";

/** Kanal sırları 2FA sırlarından ayrı, türetilmiş bir anahtarla şifrelenir. */
const secretKey = () => deriveKeyHex(loadEnv().MFA_ENCRYPTION_KEY, "channel-secrets:v1");
export const sealSecret = (v: string) => encrypt(v, secretKey());
export const openSecret = (v: string) => decrypt(v, secretKey());

export const CHANNEL_PATH: Record<string, ChannelType> = { whatsapp: "WHATSAPP", instagram: "INSTAGRAM" };

export interface SaveChannelInput {
  externalId: string;
  businessAccountId?: string | null;
  accessToken?: string;
  appSecret?: string;
}

export function waCreds(c: ChannelConnection): WaCreds {
  return { phoneNumberId: c.externalId, accessToken: openSecret(c.accessTokenEnc), businessAccountId: c.businessAccountId };
}
export function igCreds(c: ChannelConnection): IgCreds {
  return { igId: c.externalId, accessToken: openSecret(c.accessTokenEnc) };
}

/** Meta hatasını kullanıcıya gösterilecek hataya çevirir (anahtar/mesaj içeriği yazılmaz). */
export function metaHttpError(e: unknown): never {
  if (e instanceof MetaDisabledError) throw new ServiceUnavailableException({ message: e.message, code: "META_DISABLED" });
  if (e instanceof MetaApiError) throw new UnprocessableEntityException({ message: e.message, code: "META_API_ERROR" });
  throw e;
}

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly meta: MetaGateway,
  ) {}

  /** Yanıtlarda yalnızca güvenli alanlar: erişim anahtarı, uygulama sırrı ve doğrulama belirteci asla dönmez. */
  static view(c: ChannelConnection) {
    return {
      id: c.id,
      channel: c.channel,
      status: c.status,
      externalId: c.externalId,
      businessAccountId: c.businessAccountId,
      displayName: c.displayName,
      tokenHint: c.tokenLast4 ? `••••${c.tokenLast4}` : null,
      verifiedAt: c.verifiedAt,
      webhookVerifiedAt: c.webhookVerifiedAt,
      lastWebhookAt: c.lastWebhookAt,
      lastError: c.lastError,
      aiAutoReply: c.aiAutoReply,
      aiDataConsentAt: c.aiDataConsentAt,
      webhookUrl: `${appUrl(loadEnv())}/api/webhooks/meta/${c.id}`,
      updatedAt: c.updatedAt,
    };
  }

  private async get(t: TenantInfo, channel: ChannelType) {
    const c = await this.prisma.withTenant(t, (tx) => tx.channelConnection.findUnique({ where: { tenantId_channel: { tenantId: t.tenantId, channel } } }));
    if (!c) throw new NotFoundException("Kanal bağlantısı bulunamadı");
    return c;
  }

  async list(t: TenantInfo) {
    const env = loadEnv();
    const rows = await this.prisma.withTenant(t, (tx) => tx.channelConnection.findMany({ orderBy: { channel: "asc" } }));
    return {
      metaMode: this.meta.mode,
      aiMode: env.AI_MODE,
      aiAvailable: t.features.includes("AI_ASSISTANT"),
      connections: rows.map(ChannelsService.view),
    };
  }

  /** Meta panelinde "Doğrulama belirteci" alanına girilecek değer (yalnızca işletme sahibi görür). */
  async verifyToken(t: TenantInfo, channel: ChannelType) {
    const c = await this.get(t, channel);
    await this.prisma.withTenant(t, (tx) =>
      this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "channel.verify_token_viewed", entity: "ChannelConnection", entityId: c.id }),
    );
    return { verifyToken: openSecret(c.verifyTokenEnc) };
  }

  async save(t: TenantInfo, channel: ChannelType, b: SaveChannelInput) {
    if (channel === "WHATSAPP" && !b.businessAccountId) throw new BadRequestException("WhatsApp Business hesap kimliği (WABA ID) gerekli");
    return this.prisma.withTenant(t, async (tx) => {
      const existing = await tx.channelConnection.findUnique({ where: { tenantId_channel: { tenantId: t.tenantId, channel } } });
      if ((!existing?.accessTokenEnc && !b.accessToken) || (!existing?.appSecretEnc && !b.appSecret)) throw new BadRequestException("Erişim anahtarı ve uygulama gizli anahtarı gerekli");
      const secrets = {
        ...(b.accessToken ? { accessTokenEnc: sealSecret(b.accessToken), tokenLast4: b.accessToken.slice(-4) } : {}),
        ...(b.appSecret ? { appSecretEnc: sealSecret(b.appSecret) } : {}),
      };
      const changedAccount = existing && existing.externalId !== b.externalId;
      const data = {
        externalId: b.externalId,
        businessAccountId: channel === "WHATSAPP" ? b.businessAccountId : null,
        status: "DRAFT" as const,
        verifiedAt: null,
        displayName: null,
        lastError: null,
        ...(changedAccount ? { webhookVerifiedAt: null, lastWebhookAt: null } : {}),
        ...secrets,
      };
      const c = existing
        ? await tx.channelConnection.update({ where: { id: existing.id }, data })
        : await tx.channelConnection.create({
            data: {
              tenantId: t.tenantId,
              channel,
              createdById: t.userId,
              verifyTokenEnc: sealSecret(randomToken()),
              accessTokenEnc: secrets.accessTokenEnc!,
              tokenLast4: secrets.tokenLast4!,
              appSecretEnc: secrets.appSecretEnc!,
              externalId: b.externalId,
              businessAccountId: data.businessAccountId,
            },
          });
      await this.audit.log(tx, {
        tenantId: t.tenantId,
        actorId: t.userId,
        action: existing ? "channel.updated" : "channel.created",
        entity: "ChannelConnection",
        entityId: c.id,
        metadata: { channel, tokenChanged: !!b.accessToken, appSecretChanged: !!b.appSecret },
      });
      return ChannelsService.view(c);
    });
  }

  /** Bilgileri Meta Graph API ile doğrular; başarılıysa kanal "bağlı" olur. */
  async verify(t: TenantInfo, channel: ChannelType) {
    const c = await this.get(t, channel);
    if (c.status === "DISABLED") throw new ConflictException("Bağlantı kapalı; bilgileri yeniden girin");
    let displayName: string;
    try {
      displayName = (channel === "WHATSAPP" ? await this.meta.verifyWhatsApp(waCreds(c)) : await this.meta.verifyInstagram(igCreds(c))).displayName;
    } catch (e) {
      if (e instanceof MetaApiError) {
        await this.prisma.withTenant(t, (tx) => tx.channelConnection.update({ where: { id: c.id }, data: { status: "ERROR", lastError: e.message } }));
      }
      metaHttpError(e);
    }
    try {
      return await this.prisma.withTenant(t, async (tx) => {
        const u = await tx.channelConnection.update({
          where: { id: c.id },
          data: { status: "CONNECTED", displayName, verifiedAt: new Date(), lastError: null },
        });
        await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "channel.verified", entity: "ChannelConnection", entityId: c.id, metadata: { channel, mode: this.meta.mode } });
        return { ...ChannelsService.view(u), simulated: this.meta.mode === "mock" };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu hesap başka bir işletmeye bağlı. Destek için bizimle iletişime geçin.");
      }
      throw e;
    }
  }

  /** Gerekli WhatsApp şablonlarının işletmenin Meta hesabındaki onay durumu. */
  async templates(t: TenantInfo) {
    const c = await this.get(t, "WHATSAPP");
    let remote: Awaited<ReturnType<MetaGateway["listTemplates"]>> = [];
    try {
      remote = await this.meta.listTemplates(waCreds(c));
    } catch (e) {
      metaHttpError(e);
    }
    return {
      simulated: this.meta.mode === "mock",
      templates: TEMPLATES.map((d) => {
        const r = remote.filter((x) => x.name === d.name);
        const tr = r.find((x) => x.language.startsWith("tr")) ?? r[0];
        return { ...d, status: tr?.status ?? "MISSING", language: tr?.language ?? null };
      }),
    };
  }

  /**
   * Deneme mesajı: yalnızca işletme sahibinin açıkça onayladığı numaraya, Meta'nın her hesapta hazır
   * "hello_world" şablonuyla gönderilir. Test modunda gerçek gönderim yapılmaz ve bu açıkça döner.
   */
  async testMessage(t: TenantInfo, to: string) {
    const c = await this.get(t, "WHATSAPP");
    if (c.status !== "CONNECTED") throw new ConflictException("Önce bağlantıyı doğrulayın");
    let messageId: string;
    try {
      ({ messageId } = await this.meta.sendWhatsAppTemplate(waCreds(c), to, "hello_world", [], "en_US"));
    } catch (e) {
      metaHttpError(e);
    }
    await this.prisma.withTenant(t, (tx) =>
      this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "channel.test_message", entity: "ChannelConnection", entityId: c.id, metadata: { mode: this.meta.mode } }),
    );
    return { sent: this.meta.mode === "live", simulated: this.meta.mode !== "live", messageId };
  }

  async updateAi(t: TenantInfo, channel: ChannelType, b: { aiAutoReply: boolean; aiDataConsent?: boolean }) {
    if (b.aiAutoReply && !t.features.includes("AI_ASSISTANT")) throw new ForbiddenException("Yapay zekâ yanıtları Akıllı pakette bulunur");
    const c = await this.get(t, channel);
    if (b.aiAutoReply && !c.aiDataConsentAt && !b.aiDataConsent) {
      throw new BadRequestException("Yapay zekâ yanıtlarını açmak için müşteri mesajlarının yapay zekâ sağlayıcısına aktarımını onaylamalısınız");
    }
    return this.prisma.withTenant(t, async (tx) => {
      const u = await tx.channelConnection.update({
        where: { id: c.id },
        data: {
          aiAutoReply: b.aiAutoReply,
          ...(b.aiDataConsent && !c.aiDataConsentAt ? { aiDataConsentAt: new Date(), aiDataConsentBy: t.userId } : {}),
          ...(b.aiDataConsent === false ? { aiDataConsentAt: null, aiDataConsentBy: null, aiAutoReply: false } : {}),
        },
      });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "channel.ai_updated", entity: "ChannelConnection", entityId: c.id, metadata: { aiAutoReply: u.aiAutoReply, consent: !!u.aiDataConsentAt } });
      return ChannelsService.view(u);
    });
  }

  /** Bağlantıyı kapatır ve sırları siler; sohbet geçmişi korunur. */
  async disconnect(t: TenantInfo, channel: ChannelType) {
    const c = await this.get(t, channel);
    return this.prisma.withTenant(t, async (tx) => {
      const u = await tx.channelConnection.update({
        where: { id: c.id },
        data: { status: "DISABLED", accessTokenEnc: "", tokenLast4: "", appSecretEnc: "", aiAutoReply: false, verifiedAt: null, webhookVerifiedAt: null },
      });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "channel.disconnected", entity: "ChannelConnection", entityId: c.id, metadata: { channel } });
      return ChannelsService.view(u);
    });
  }
}
