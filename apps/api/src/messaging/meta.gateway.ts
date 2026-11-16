import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../config/env";
import { renderTemplate } from "./templates";

export interface WaCreds {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId?: string | null;
}
export interface IgCreds {
  igId: string;
  accessToken: string;
  /** ProGüzellik uygulamasıyla (Unified Login) bağlandı: istekler graph.facebook.com'a sistem kullanıcısı anahtarıyla gider. */
  managed?: boolean;
}
export interface IgAccount {
  id: string;
  username: string | null;
}
export interface MetaTemplate {
  name: string;
  status: string;
  language: string;
  category: string;
}

/** Meta API isteği reddetti (geçersiz anahtar, izin, kapalı pencere vb.). Mesaj içerikleri hataya yazılmaz. */
export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

/** Bu sunucuda Meta bağlantısı kapalı (canlıda META_MODE=mock): hiçbir istek yapılmaz, "gönderildi" sayılmaz. */
export class MetaDisabledError extends Error {
  constructor() {
    super("Meta (WhatsApp/Instagram) bağlantısı bu sunucuda kapalı: istek yapılmadı");
  }
}

/** İşletmenin kendi Meta hesabı üzerinden yapılan tüm Graph API çağrıları. */
export abstract class MetaGateway {
  abstract readonly mode: "mock" | "live" | "disabled";
  abstract verifyWhatsApp(c: WaCreds): Promise<{ displayName: string }>;
  abstract verifyInstagram(c: IgCreds): Promise<{ displayName: string }>;
  abstract listTemplates(c: WaCreds): Promise<MetaTemplate[]>;
  abstract sendWhatsAppTemplate(c: WaCreds, to: string, template: string, params: string[], language?: string): Promise<{ messageId: string }>;
  abstract sendWhatsAppText(c: WaCreds, to: string, text: string): Promise<{ messageId: string }>;
  abstract sendInstagramText(c: IgCreds, to: string, text: string): Promise<{ messageId: string }>;
  /* Embedded Signup (ProGüzellik Meta uygulaması). Uç noktalar: developers.facebook.com/docs/whatsapp/embedded-signup */
  /** Embedded Signup'ın döndüğü kodu (30 sn geçerli) işletme anahtarına çevirir. */
  abstract exchangeCode(app: MetaAppCreds, code: string): Promise<{ accessToken: string }>;
  /** WABA'daki numara kimlikleri (tarayıcıdan gelen kimliklerin gerçekten bu hesaba ait olduğunu doğrulamak için). */
  abstract wabaPhoneNumbers(wabaId: string, accessToken: string): Promise<string[]>;
  /** Uygulamayı WABA'nın webhook'larına abone eder. */
  abstract subscribeApp(wabaId: string, accessToken: string): Promise<void>;
  /** Aboneliği kaldırır (bağlantı kapatılınca). */
  abstract unsubscribeApp(wabaId: string, accessToken: string): Promise<void>;
  /** Numarayı Cloud API'ye kaydeder; PIN iki adımlı doğrulama PIN'i olur. */
  abstract registerPhone(phoneNumberId: string, accessToken: string, pin: string): Promise<void>;
  /*
   * "Instagram'ı bağla" (Instagram API with Unified Login). Kod aynı exchangeCode ile anahtara çevrilir; anahtar
   * salonun işletme portföyüne ait sistem kullanıcısı anahtarıdır.
   * Belge: developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
   */
  /** Salonun Meta penceresinde paylaştığı Instagram profesyonel hesapları. */
  abstract instagramAccounts(accessToken: string): Promise<IgAccount[]>;
  /** Hesabı uygulamanın webhook'larına (messages) abone eder. */
  abstract subscribeInstagram(igId: string, accessToken: string): Promise<void>;
  /** Aboneliği kaldırır (bağlantı kapatılınca). */
  abstract unsubscribeInstagram(igId: string, accessToken: string): Promise<void>;
}

export interface MetaAppCreds {
  appId: string;
  appSecret: string;
}

/** Türkiye numaralarını E.164 (başında + olmadan) biçimine getirir: 0555… → 90555… */
export function toE164(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("90")) return digits;
  if (digits.startsWith("0")) return `90${digits.slice(1)}`;
  if (digits.length === 10) return `90${digits}`;
  return digits;
}

export class DisabledMetaGateway extends MetaGateway {
  readonly mode = "disabled" as const;
  private async fail(): Promise<never> {
    throw new MetaDisabledError();
  }
  verifyWhatsApp(_c: WaCreds) {
    return this.fail();
  }
  verifyInstagram(_c: IgCreds) {
    return this.fail();
  }
  listTemplates(_c: WaCreds) {
    return this.fail();
  }
  sendWhatsAppTemplate(_c: WaCreds, _to: string, _template: string, _params: string[]) {
    return this.fail();
  }
  sendWhatsAppText(_c: WaCreds, _to: string, _text: string) {
    return this.fail();
  }
  sendInstagramText(_c: IgCreds, _to: string, _text: string) {
    return this.fail();
  }
  exchangeCode(_a: MetaAppCreds, _code: string) {
    return this.fail();
  }
  wabaPhoneNumbers(_w: string, _t: string) {
    return this.fail();
  }
  subscribeApp(_w: string, _t: string) {
    return this.fail();
  }
  unsubscribeApp(_w: string, _t: string) {
    return this.fail();
  }
  registerPhone(_p: string, _t: string, _pin: string) {
    return this.fail();
  }
  instagramAccounts(_t: string) {
    return this.fail();
  }
  subscribeInstagram(_i: string, _t: string) {
    return this.fail();
  }
  unsubscribeInstagram(_i: string, _t: string) {
    return this.fail();
  }
}

export type MockSent = { kind: "wa_template" | "wa_text" | "ig_text"; from: string; to: string; text: string; messageId: string; template?: string };

/**
 * Yerel/test: Meta'ya HİÇBİR istek yapmaz. Doğrulama sahte bir ad döner ("gecersiz" içeren anahtarlar reddedilir),
 * gönderimler yalnızca bellekte tutulur. Arayüz bu modu açıkça "test modu" olarak gösterir.
 */
@Injectable()
export class MockMetaGateway extends MetaGateway {
  readonly mode = "mock" as const;
  readonly outbox: MockSent[] = [];
  private readonly logger = new Logger("MockMeta");

  private check(token: string) {
    if (token.includes("gecersiz")) throw new MetaApiError("Geçersiz erişim anahtarı (test)", 401, 190);
  }
  private push(m: Omit<MockSent, "messageId">) {
    const messageId = `mock.${randomUUID()}`;
    this.outbox.push({ ...m, messageId });
    this.logger.log(`[TEST – gönderilmedi] ${m.kind} → ${m.to.slice(0, 4)}***`);
    return { messageId };
  }
  async verifyWhatsApp(c: WaCreds) {
    this.check(c.accessToken);
    return { displayName: `Test numarası (${c.phoneNumberId.slice(-4)})` };
  }
  async verifyInstagram(c: IgCreds) {
    this.check(c.accessToken);
    return { displayName: `@test_hesap_${c.igId.slice(-4)}` };
  }
  async listTemplates(c: WaCreds) {
    this.check(c.accessToken);
    return [] as MetaTemplate[];
  }
  async sendWhatsAppTemplate(c: WaCreds, to: string, template: string, params: string[]) {
    this.check(c.accessToken);
    if (to.endsWith("0000000000")) throw new MetaApiError("Test: geçersiz numara", 400);
    return this.push({ kind: "wa_template", from: c.phoneNumberId, to, template, text: renderTemplate(template, params) });
  }
  async sendWhatsAppText(c: WaCreds, to: string, text: string) {
    this.check(c.accessToken);
    return this.push({ kind: "wa_text", from: c.phoneNumberId, to, text });
  }
  async sendInstagramText(c: IgCreds, to: string, text: string) {
    this.check(c.accessToken);
    return this.push({ kind: "ig_text", from: c.igId, to, text });
  }
  /** Test: "gecersiz" içeren kod reddedilir; anahtar koddan türetilir. WABA'daki numaralar testte `phones` ile belirlenir. */
  readonly phones = new Map<string, string[]>();
  readonly subscribed = new Set<string>();
  readonly registered = new Map<string, string>();
  async exchangeCode(_a: MetaAppCreds, code: string) {
    if (code.includes("gecersiz")) throw new MetaApiError("Kod geçersiz veya süresi dolmuş (test)", 400, 100);
    return { accessToken: `EAAmock${code}`.padEnd(40, "x") };
  }
  async wabaPhoneNumbers(wabaId: string, accessToken: string) {
    this.check(accessToken);
    return this.phones.get(wabaId) ?? [];
  }
  async subscribeApp(wabaId: string, accessToken: string) {
    this.check(accessToken);
    this.subscribed.add(wabaId);
  }
  async unsubscribeApp(wabaId: string, accessToken: string) {
    this.check(accessToken);
    this.subscribed.delete(wabaId);
  }
  async registerPhone(phoneNumberId: string, accessToken: string, pin: string) {
    this.check(accessToken);
    this.registered.set(phoneNumberId, pin);
  }
  /**
   * Test: koda göre paylaşılan Instagram hesapları (`igAccounts`, anahtar kodda geçen ifade). Yerel arayüz
   * denemesi için "yerel-deneme" içeren kod tek bir sahte hesap döner.
   */
  readonly igAccounts = new Map<string, IgAccount[]>();
  readonly igSubscribed = new Set<string>();
  async instagramAccounts(accessToken: string) {
    this.check(accessToken);
    for (const [k, v] of this.igAccounts) if (accessToken.includes(k)) return v;
    return accessToken.includes("yerel-deneme") ? [{ id: "17841400000000001", username: "deneme_salon" }] : [];
  }
  async subscribeInstagram(igId: string, accessToken: string) {
    this.check(accessToken);
    this.igSubscribed.add(igId);
  }
  async unsubscribeInstagram(igId: string, accessToken: string) {
    this.check(accessToken);
    this.igSubscribed.delete(igId);
  }
}

type Fetch = typeof fetch;

/**
 * Gerçek Graph API istemcisi. Uç noktalar Meta belgelerine göre yazıldı; GERÇEK BİR HESAPLA HENÜZ DENENMEDİ.
 *  - WhatsApp Cloud API: graph.facebook.com/{ver}/{phone_number_id}/messages
 *  - Instagram (Instagram Login, elle kurulum): graph.instagram.com/{ver}/{ig_id}/messages
 *  - Instagram (Unified Login, "Instagram'ı bağla"): graph.facebook.com/{ver}/{ig_id}/messages
 */
@Injectable()
export class LiveMetaGateway extends MetaGateway {
  readonly mode = "live" as const;

  constructor(private readonly fetchImpl: Fetch = fetch) {
    super();
  }

  private async call<T>(url: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await this.fetchImpl(url, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
    if (!res.ok || body.error) {
      throw new MetaApiError(`Meta API hatası (${res.status}): ${body.error?.message ?? "bilinmeyen"}`.slice(0, 300), res.status, body.error?.code);
    }
    return body;
  }

  private wa(path: string) {
    return `https://graph.facebook.com/${loadEnv().META_GRAPH_VERSION}/${path}`;
  }
  private ig(path: string) {
    return `https://graph.instagram.com/${loadEnv().INSTAGRAM_GRAPH_VERSION}/${path}`;
  }

  async verifyWhatsApp(c: WaCreds) {
    const r = await this.call<{ display_phone_number?: string; verified_name?: string }>(
      this.wa(`${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name`),
      c.accessToken,
    );
    return { displayName: [r.verified_name, r.display_phone_number].filter(Boolean).join(" · ") || c.phoneNumberId };
  }

  async verifyInstagram(c: IgCreds) {
    if (c.managed) {
      const r = await this.call<{ id?: string; username?: string }>(this.wa(`${encodeURIComponent(c.igId)}?fields=id,username`), c.accessToken);
      return { displayName: r.username ? `@${r.username}` : c.igId };
    }
    const r = await this.call<{ username?: string; user_id?: string }>(this.ig(`me?fields=user_id,username`), c.accessToken);
    if (r.user_id && r.user_id !== c.igId) throw new MetaApiError("Erişim anahtarı girilen Instagram hesabına ait değil", 400);
    return { displayName: r.username ? `@${r.username}` : c.igId };
  }

  async listTemplates(c: WaCreds) {
    if (!c.businessAccountId) throw new MetaApiError("WhatsApp Business hesap kimliği (WABA ID) girilmemiş", 400);
    const r = await this.call<{ data?: MetaTemplate[] }>(
      this.wa(`${encodeURIComponent(c.businessAccountId)}/message_templates?fields=name,status,language,category&limit=200`),
      c.accessToken,
    );
    return (r.data ?? []).map(({ name, status, language, category }) => ({ name, status, language, category }));
  }

  private async sendWa(c: WaCreds, payload: Record<string, unknown>) {
    const r = await this.call<{ messages?: { id: string }[] }>(this.wa(`${encodeURIComponent(c.phoneNumberId)}/messages`), c.accessToken, {
      method: "POST",
      body: { messaging_product: "whatsapp", ...payload },
    });
    const id = r.messages?.[0]?.id;
    if (!id) throw new MetaApiError("Meta mesaj kimliği dönmedi");
    return { messageId: id };
  }

  sendWhatsAppTemplate(c: WaCreds, to: string, template: string, params: string[], language = "tr") {
    return this.sendWa(c, {
      to: toE164(to),
      type: "template",
      template: {
        name: template,
        language: { code: language },
        ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}),
      },
    });
  }

  sendWhatsAppText(c: WaCreds, to: string, text: string) {
    return this.sendWa(c, { to: toE164(to), type: "text", text: { body: text.slice(0, 4096), preview_url: false } });
  }

  async sendInstagramText(c: IgCreds, to: string, text: string) {
    const url = c.managed ? this.wa(`${encodeURIComponent(c.igId)}/messages`) : this.ig(`${encodeURIComponent(c.igId)}/messages`);
    const r = await this.call<{ message_id?: string }>(url, c.accessToken, {
      method: "POST",
      body: { recipient: { id: to }, message: { text: truncateBytes(text, 1000) } },
    });
    if (!r.message_id) throw new MetaApiError("Meta mesaj kimliği dönmedi");
    return { messageId: r.message_id };
  }

  async exchangeCode(app: MetaAppCreds, code: string) {
    const q = new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, code });
    // Sır sorgu dizesinde gider (Meta belgesindeki biçim); hata iletisine adres yazılmaz.
    const res = await this.fetchImpl(this.wa(`oauth/access_token?${q}`), { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string; code?: number } };
    if (!res.ok || body.error || !body.access_token) {
      throw new MetaApiError(`Meta API hatası (${res.status}): ${body.error?.message ?? "anahtar alınamadı"}`.slice(0, 300), res.status, body.error?.code);
    }
    return { accessToken: body.access_token };
  }

  async wabaPhoneNumbers(wabaId: string, accessToken: string) {
    const r = await this.call<{ data?: { id: string }[] }>(this.wa(`${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`), accessToken);
    return (r.data ?? []).map((p) => p.id);
  }

  async subscribeApp(wabaId: string, accessToken: string) {
    await this.call(this.wa(`${encodeURIComponent(wabaId)}/subscribed_apps`), accessToken, { method: "POST" });
  }

  async unsubscribeApp(wabaId: string, accessToken: string) {
    await this.call(this.wa(`${encodeURIComponent(wabaId)}/subscribed_apps`), accessToken, { method: "DELETE" });
  }

  async instagramAccounts(accessToken: string) {
    const r = await this.call<{ data?: { id: string; username?: string }[] }>(this.wa(`me/assigned_instagram_accounts?fields=id,username&limit=100`), accessToken);
    return (r.data ?? []).map((a) => ({ id: a.id, username: a.username ?? null }));
  }

  async subscribeInstagram(igId: string, accessToken: string) {
    await this.call(this.wa(`${encodeURIComponent(igId)}/subscribed_apps?subscribed_fields=messages`), accessToken, { method: "POST" });
  }

  async unsubscribeInstagram(igId: string, accessToken: string) {
    await this.call(this.wa(`${encodeURIComponent(igId)}/subscribed_apps`), accessToken, { method: "DELETE" });
  }

  async registerPhone(phoneNumberId: string, accessToken: string, pin: string) {
    await this.call(this.wa(`${encodeURIComponent(phoneNumberId)}/register`), accessToken, { method: "POST", body: { messaging_product: "whatsapp", pin } });
  }
}

/** Instagram metin sınırı 1000 bayt (UTF-8). */
export function truncateBytes(s: string, max: number) {
  if (Buffer.byteLength(s) <= max) return s;
  let out = "";
  for (const ch of s) {
    if (Buffer.byteLength(out + ch + "…") > max) break;
    out += ch;
  }
  return out + "…";
}

export function metaGatewayFactory(mock: MockMetaGateway): MetaGateway {
  const env = loadEnv();
  if (env.META_MODE === "live") return new LiveMetaGateway();
  return env.NODE_ENV === "production" ? new DisabledMetaGateway() : mock;
}
