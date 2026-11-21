import { randomInt } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ChannelConnection, ChannelType, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { TenantInfo } from "../common/decorators";
import { appUrl, loadEnv, metaApp, metaIgApp } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { decrypt, deriveKeyHex, encrypt, randomToken } from "../security/crypto";
import { IgCreds, MetaApiError, MetaDisabledError, MetaGateway, WaCreds } from "./meta.gateway";
import { TEMPLATES } from "./templates";
import { consentProvider, consentValid } from "./chat/ai-consent";

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
  return { igId: c.externalId, accessToken: openSecret(c.accessTokenEnc), managed: c.managed };
}

/** Meta hatasını kullanıcıya gösterilecek hataya çevirir (anahtar/mesaj içeriği yazılmaz). */
export function metaHttpError(e: unknown): never {
  if (e instanceof MetaDisabledError) throw new ServiceUnavailableException({ message: e.message, code: "META_DISABLED" });
  if (e instanceof MetaApiError) throw new UnprocessableEntityException({ message: e.message, code: "META_API_ERROR" });
  throw e;
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger("Channels");

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
      // Onay başka bir sağlayıcıya verildiyse geçersiz sayılır; panel yeniden onay ister.
      aiDataConsentAt: consentValid(c) ? c.aiDataConsentAt : null,
      aiDataConsentProvider: c.aiDataConsentProvider,
      managed: c.managed,
      webhookUrl: c.managed ? `${appUrl(loadEnv())}/api/webhooks/meta` : `${appUrl(loadEnv())}/api/webhooks/meta/${c.id}`,
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
    // Meta bu sunucuda kapalıysa düğme gösterilmez (salon Meta penceresini bitirip sonra hata almasın).
    const app = this.meta.mode === "disabled" ? null : metaApp(env);
    return {
      metaMode: this.meta.mode,
      // "WhatsApp'ı bağla" düğmesi için tarayıcıya yalnızca herkese açık kimlikler gider (uygulama sırrı asla).
      embeddedSignup: app ? { appId: app.appId, configId: app.configId, graphVersion: env.META_GRAPH_VERSION } : null,
      // "Instagram'ı bağla" düğmesi: ayrı Instagram yapılandırması tanımlıysa (yine yalnızca herkese açık kimlikler).
      instagramConnect: app && metaIgApp(env) ? { appId: app.appId, configId: metaIgApp(env)!.igConfigId, graphVersion: env.META_GRAPH_VERSION } : null,
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
        managed: false,
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

  /**
   * Embedded Signup tamamlandı: tarayıcıdan gelen kod sunucuda işletme anahtarına çevrilir, numaranın gerçekten
   * o WABA'ya ait olduğu Meta'dan doğrulanır, uygulama WABA'nın webhook'larına abone edilir ve numara Cloud API'ye
   * kaydedilir. Adımlar Meta'nın Tech Provider belgesindeki sırayla yapılır.
   */
  async embeddedSignup(t: TenantInfo, b: { code: string; phoneNumberId: string; wabaId: string }) {
    const app = metaApp(loadEnv());
    if (!app) throw new ServiceUnavailableException({ message: "WhatsApp'ı bağla özelliği bu sunucuda açık değil", code: "ES_DISABLED" });
    const existing = await this.prisma.withTenant(t, (tx) => tx.channelConnection.findUnique({ where: { tenantId_channel: { tenantId: t.tenantId, channel: "WHATSAPP" } } }));
    if (existing && existing.status === "CONNECTED" && existing.externalId !== b.phoneNumberId) {
      throw new ConflictException("Bu işletmede bağlı bir WhatsApp numarası var; önce bağlantıyı kapatın");
    }
    // Numara başka bir işletmede bağlıysa Meta'ya hiç istek yapılmaz (abonelik/kayıt değiştirilmez).
    const taken = await this.prisma.platform.channelConnection.findFirst({ where: { channel: "WHATSAPP", externalId: b.phoneNumberId, status: "CONNECTED", NOT: { tenantId: t.tenantId } }, select: { id: true } });
    if (taken) throw new ConflictException("Bu numara başka bir işletmeye bağlı. Destek için bizimle iletişime geçin.");
    let token: string;
    try {
      ({ accessToken: token } = await this.meta.exchangeCode(app, b.code));
      const phones = await this.meta.wabaPhoneNumbers(b.wabaId, token);
      if (!phones.includes(b.phoneNumberId)) throw new MetaApiError("Seçilen numara bu WhatsApp Business hesabında bulunamadı", 400);
    } catch (e) {
      metaHttpError(e);
    }
    const pin = existing?.pinEnc && existing.externalId === b.phoneNumberId ? openSecret(existing.pinEnc) : String(randomInt(0, 1_000_000)).padStart(6, "0");
    const creds = { phoneNumberId: b.phoneNumberId, accessToken: token, businessAccountId: b.wabaId };
    let displayName: string | null = null;
    let error: string | null = null;
    try {
      await this.meta.subscribeApp(b.wabaId, token);
      await this.meta.registerPhone(b.phoneNumberId, token, pin);
      displayName = (await this.meta.verifyWhatsApp(creds)).displayName;
    } catch (e) {
      if (!(e instanceof MetaApiError)) metaHttpError(e);
      error = (e as MetaApiError).message;
    }
    const data = {
      externalId: b.phoneNumberId,
      businessAccountId: b.wabaId,
      managed: true,
      status: error ? ("ERROR" as const) : ("CONNECTED" as const),
      displayName,
      verifiedAt: error ? null : new Date(),
      lastError: error,
      accessTokenEnc: sealSecret(token),
      tokenLast4: token.slice(-4),
      appSecretEnc: "",
      pinEnc: sealSecret(pin),
      ...(existing?.externalId !== b.phoneNumberId ? { webhookVerifiedAt: null, lastWebhookAt: null } : {}),
    };
    try {
      return await this.prisma.withTenant(t, async (tx) => {
        const c = existing
          ? await tx.channelConnection.update({ where: { id: existing.id }, data })
          : await tx.channelConnection.create({ data: { ...data, tenantId: t.tenantId, channel: "WHATSAPP", createdById: t.userId, verifyTokenEnc: sealSecret(randomToken()) } });
        await this.audit.log(tx, {
          tenantId: t.tenantId,
          actorId: t.userId,
          action: "channel.embedded_signup",
          entity: "ChannelConnection",
          entityId: c.id,
          metadata: { channel: "WHATSAPP", ok: !error, mode: this.meta.mode },
        });
        return { ...ChannelsService.view(c), simulated: this.meta.mode === "mock" };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Bu numara başka bir işletmeye bağlı. Destek için bizimle iletişime geçin.");
      }
      throw e;
    }
  }

  /**
   * "Instagram'ı bağla" tamamlandı (Instagram API with Unified Login). Tarayıcıdan YALNIZCA kısa ömürlü kod gelir:
   * hesap kimliği tarayıcıdan alınmaz, sunucuda anahtarla Meta'dan okunur (salon yalnız kendi paylaştığı hesabı
   * bağlayabilir). Hesap başka bir işletmede bağlıysa Meta'da hiçbir şey değiştirilmez.
   */
  async instagramSignup(t: TenantInfo, b: { code: string }) {
    const app = metaIgApp(loadEnv());
    if (!app) throw new ServiceUnavailableException({ message: "Instagram'ı bağla özelliği bu sunucuda açık değil", code: "IG_CONNECT_DISABLED" });
    const existing = await this.prisma.withTenant(t, (tx) => tx.channelConnection.findUnique({ where: { tenantId_channel: { tenantId: t.tenantId, channel: "INSTAGRAM" } } }));
    let token: string;
    let account: { id: string; username: string | null };
    try {
      ({ accessToken: token } = await this.meta.exchangeCode(app, b.code));
      const accounts = await this.meta.instagramAccounts(token);
      if (accounts.length === 0) throw new MetaApiError("Meta penceresinde bir Instagram profesyonel hesabı paylaşılmadı. Tekrar deneyip salonunuzun hesabını seçin.", 400);
      if (accounts.length > 1) throw new MetaApiError("Meta penceresinde birden fazla Instagram hesabı seçildi. Tekrar deneyip yalnızca salonunuzun hesabını seçin.", 400);
      account = accounts[0];
    } catch (e) {
      metaHttpError(e);
    }
    if (existing && existing.status === "CONNECTED" && existing.externalId !== account.id) {
      throw new ConflictException("Bu işletmede bağlı bir Instagram hesabı var; önce bağlantıyı kapatın");
    }
    const taken = await this.prisma.platform.channelConnection.findFirst({ where: { channel: "INSTAGRAM", externalId: account.id, status: "CONNECTED", NOT: { tenantId: t.tenantId } }, select: { id: true } });
    if (taken) throw new ConflictException("Bu Instagram hesabı başka bir işletmeye bağlı. Destek için bizimle iletişime geçin.");
    let displayName: string | null = account.username ? `@${account.username}` : null;
    let error: string | null = null;
    try {
      await this.meta.subscribeInstagram(account.id, token);
      displayName = (await this.meta.verifyInstagram({ igId: account.id, accessToken: token, managed: true })).displayName;
    } catch (e) {
      if (!(e instanceof MetaApiError)) metaHttpError(e);
      error = (e as MetaApiError).message;
    }
    const data = {
      externalId: account.id,
      businessAccountId: null,
      managed: true,
      status: error ? ("ERROR" as const) : ("CONNECTED" as const),
      displayName,
      verifiedAt: error ? null : new Date(),
      lastError: error,
      accessTokenEnc: sealSecret(token),
      tokenLast4: token.slice(-4),
      appSecretEnc: "",
      ...(existing?.externalId !== account.id ? { webhookVerifiedAt: null, lastWebhookAt: null } : {}),
    };
    return this.prisma.withTenant(t, async (tx) => {
      const c = existing
        ? await tx.channelConnection.update({ where: { id: existing.id }, data })
        : await tx.channelConnection.create({ data: { ...data, tenantId: t.tenantId, channel: "INSTAGRAM", createdById: t.userId, verifyTokenEnc: sealSecret(randomToken()) } });
      await this.audit.log(tx, {
        tenantId: t.tenantId,
        actorId: t.userId,
        action: "channel.instagram_connect",
        entity: "ChannelConnection",
        entityId: c.id,
        metadata: { channel: "INSTAGRAM", ok: !error, mode: this.meta.mode },
      });
      return { ...ChannelsService.view(c), simulated: this.meta.mode === "mock" };
    });
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
    const valid = consentValid(c);
    if (b.aiAutoReply && !valid && !b.aiDataConsent) {
      throw new BadRequestException("Yapay zekâ yanıtlarını açmak için müşteri mesajlarının yapay zekâ sağlayıcısına aktarımını onaylamalısınız");
    }
    return this.prisma.withTenant(t, async (tx) => {
      const u = await tx.channelConnection.update({
        where: { id: c.id },
        data: {
          aiAutoReply: b.aiAutoReply,
          ...(b.aiDataConsent && !valid ? { aiDataConsentAt: new Date(), aiDataConsentBy: t.userId, aiDataConsentProvider: consentProvider() } : {}),
          ...(b.aiDataConsent === false ? { aiDataConsentAt: null, aiDataConsentBy: null, aiDataConsentProvider: null, aiAutoReply: false } : {}),
        },
      });
      await this.audit.log(tx, { tenantId: t.tenantId, actorId: t.userId, action: "channel.ai_updated", entity: "ChannelConnection", entityId: c.id, metadata: { aiAutoReply: u.aiAutoReply, consent: !!u.aiDataConsentAt, provider: u.aiDataConsentProvider } });
      return ChannelsService.view(u);
    });
  }

  /** Bağlantıyı kapatır ve sırları siler; sohbet geçmişi korunur. */
  async disconnect(t: TenantInfo, channel: ChannelType) {
    const c = await this.get(t, channel);
    // ProGüzellik uygulamasıyla bağlıysa WABA aboneliği de kaldırılır; Meta'ya ulaşılamazsa bağlantı yine kapanır.
    if (c.managed && c.channel === "WHATSAPP" && c.businessAccountId && c.accessTokenEnc) {
      await this.meta.unsubscribeApp(c.businessAccountId, openSecret(c.accessTokenEnc)).catch((e: Error) => this.logger.warn(`Abonelik kaldırılamadı: ${e.message}`));
    }
    if (c.managed && c.channel === "INSTAGRAM" && c.accessTokenEnc) {
      await this.meta.unsubscribeInstagram(c.externalId, openSecret(c.accessTokenEnc)).catch((e: Error) => this.logger.warn(`Instagram aboneliği kaldırılamadı: ${e.message}`));
    }
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
