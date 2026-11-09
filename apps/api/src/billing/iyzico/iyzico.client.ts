import { Injectable, Logger } from "@nestjs/common";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { loadEnv } from "../../config/env";

/** iyzico SANDBOX (test) adresi: para çekilmez. */
export const IYZICO_SANDBOX_HOST = "sandbox-api.iyzipay.com";
/** iyzico CANLI adresi: gerçek kartlardan para çekilir. */
export const IYZICO_LIVE_HOST = "api.iyzipay.com";

export type IyzicoInterval = "MONTHLY" | "YEARLY";

export interface IyzicoCustomer {
  name: string;
  surname: string;
  email: string;
  /** +90 ile başlayan numara */
  gsmNumber: string;
  identityNumber: string;
  billingAddress: { contactName: string; city: string; country: string; address: string };
}

export interface IyzicoOrder {
  referenceCode: string;
  price: number;
  currencyCode?: string;
  startPeriod?: number;
  endPeriod?: number;
  orderStatus: "WAITING" | "SUCCESS" | "FAILED" | string;
}

export interface IyzicoSubscriptionDetail {
  referenceCode: string;
  customerReferenceCode?: string;
  pricingPlanReferenceCode: string;
  subscriptionStatus: "ACTIVE" | "PENDING" | "UNPAID" | "UPGRADED" | "CANCELED" | "EXPIRED" | string;
  startDate?: number;
  endDate?: number;
  orders: IyzicoOrder[];
}

export interface IyzicoCheckoutResult {
  referenceCode: string;
  customerReferenceCode?: string;
  pricingPlanReferenceCode: string;
  subscriptionStatus: string;
  startDate?: number;
}

export class IyzicoError extends Error {
  constructor(
    message: string,
    readonly errorCode?: string,
  ) {
    super(message);
  }
}

/** iyzico Abonelik API'si (testlerde sahte uygulamayla değiştirilir). */
export abstract class IyzicoClient {
  /** "sandbox" | "live" | null (yapılandırılmadı) */
  abstract get environment(): "sandbox" | "live" | null;
  abstract createProduct(name: string, description: string): Promise<{ referenceCode: string }>;
  /** Aynı adlı ürün iyzico'da zaten varsa (ör. kayıt bizde yok) referansı bulunur. */
  abstract findProduct(name: string): Promise<{ referenceCode: string } | null>;
  /** Ürün altında aynı adlı ödeme planı (tutar ve dönem çağıran tarafından doğrulanır). */
  abstract findPricingPlan(productRef: string, name: string): Promise<{ referenceCode: string; price: number; interval: IyzicoInterval } | null>;
  abstract createPricingPlan(productRef: string, p: { name: string; price: string; interval: IyzicoInterval }): Promise<{ referenceCode: string }>;
  abstract initCheckout(p: { conversationId: string; callbackUrl: string; pricingPlanReferenceCode: string; customer: IyzicoCustomer }): Promise<{ token: string; checkoutFormContent: string; tokenExpireTime?: number }>;
  abstract retrieveCheckout(token: string): Promise<IyzicoCheckoutResult>;
  abstract getSubscription(ref: string): Promise<IyzicoSubscriptionDetail>;
  abstract cancelSubscription(ref: string): Promise<void>;
}

/** IYZWSv2 imzası: HMACSHA256(randomKey + uriPath + body, secretKey) → hex; başlık "IYZWSv2 base64(apiKey:..&randomKey:..&signature:..)". */
export function iyzicoAuthHeader(apiKey: string, secretKey: string, randomKey: string, uriPath: string, body: string) {
  const signature = createHmac("sha256", secretKey).update(randomKey + uriPath + body).digest("hex");
  return "IYZWSv2 " + Buffer.from(`apiKey:${apiKey}&randomKey:${randomKey}&signature:${signature}`).toString("base64");
}

/**
 * Abonelik bildirimi imzası (X-IYZ-SIGNATURE-V3): HMACSHA256(merchantId + secretKey + eventType + subscriptionRef + orderRef + customerRef, secretKey) → hex.
 * Dokümanın metni sırayı "secretKey, merchantId" diye yazıyor, örnek kodlar "merchantId, secretKey" kullanıyor; ikisi de kabul edilir.
 */
export function verifyIyzicoSubscriptionSignature(
  p: { merchantId: string; secretKey: string; eventType: string; subscriptionReferenceCode: string; orderReferenceCode: string; customerReferenceCode: string },
  header: string,
) {
  const tail = p.eventType + p.subscriptionReferenceCode + p.orderReferenceCode + p.customerReferenceCode;
  const candidates = [p.merchantId + p.secretKey + tail, p.secretKey + p.merchantId + tail].map((m) => createHmac("sha256", p.secretKey).update(m).digest("hex"));
  const got = Buffer.from(header.trim().toLowerCase());
  return candidates.some((c) => {
    const exp = Buffer.from(c);
    return exp.length === got.length && timingSafeEqual(exp, got);
  });
}

type Json = Record<string, unknown>;

@Injectable()
export class HttpIyzicoClient extends IyzicoClient {
  private readonly logger = new Logger("iyzico");

  private get cfg() {
    const env = loadEnv();
    return { apiKey: env.IYZICO_API_KEY, secretKey: env.IYZICO_SECRET_KEY, base: env.IYZICO_BASE_URL.replace(/\/$/, "") };
  }

  get environment() {
    const { apiKey, secretKey, base } = this.cfg;
    if (!apiKey || !secretKey) return null;
    let host: string;
    try {
      host = new URL(base).host;
    } catch {
      return null;
    }
    if (host === IYZICO_SANDBOX_HOST) return "sandbox";
    // Canlı adreste test anahtarı kullanılmaz (yanlış eşleşme: bağlantı kurulmaz).
    if (host === IYZICO_LIVE_HOST) return apiKey.startsWith("sandbox-") || secretKey.startsWith("sandbox-") ? null : "live";
    return null;
  }

  private async call<T extends Json>(method: "GET" | "POST", path: string, body?: Json): Promise<T> {
    const { apiKey, secretKey, base } = this.cfg;
    if (!this.environment || !apiKey || !secretKey) throw new IyzicoError("iyzico yapılandırılmadı (adres veya anahtar uyumsuz)", "NOT_CONFIGURED");
    const payload = body ? JSON.stringify(body) : "";
    const rnd = Date.now().toString() + randomBytes(6).toString("hex");
    const uriPath = path.split("?")[0];
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: iyzicoAuthHeader(apiKey, secretKey, rnd, uriPath, payload), "x-iyzi-rnd": rnd, "Content-Type": "application/json", Accept: "application/json" },
      body: method === "POST" ? payload : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as Json;
    if (json.status !== "success") {
      const msg = String(json.errorMessage ?? `iyzico HTTP ${res.status}`);
      this.logger.warn(`${method} ${uriPath} başarısız: ${json.errorCode ?? res.status} ${msg}`);
      throw new IyzicoError(msg, json.errorCode ? String(json.errorCode) : undefined);
    }
    return json as T;
  }

  async createProduct(name: string, description: string) {
    const r = await this.call<{ data: { referenceCode: string } }>("POST", "/v2/subscription/products", { locale: "tr", name, description });
    return { referenceCode: r.data.referenceCode };
  }

  async findProduct(name: string) {
    for (let page = 1; page <= 10; page++) {
      const r = await this.call<{ data: { items?: { referenceCode: string; name: string }[]; pageCount?: number } }>("GET", `/v2/subscription/products?page=${page}&count=100`);
      const hit = r.data.items?.find((p) => p.name === name);
      if (hit) return { referenceCode: hit.referenceCode };
      if (!r.data.items?.length || page >= (r.data.pageCount ?? 1)) break;
    }
    return null;
  }

  async findPricingPlan(productRef: string, name: string) {
    for (let page = 1; page <= 10; page++) {
      const r = await this.call<{ data: { items?: { referenceCode: string; name: string; price: number; paymentInterval: IyzicoInterval; paymentIntervalCount?: number }[]; pageCount?: number } }>(
        "GET",
        `/v2/subscription/products/${encodeURIComponent(productRef)}/pricing-plans?page=${page}&count=100`,
      );
      const hit = r.data.items?.find((p) => p.name === name && (p.paymentIntervalCount ?? 1) === 1);
      if (hit) return { referenceCode: hit.referenceCode, price: Number(hit.price), interval: hit.paymentInterval };
      if (!r.data.items?.length || page >= (r.data.pageCount ?? 1)) break;
    }
    return null;
  }

  async createPricingPlan(productRef: string, p: { name: string; price: string; interval: IyzicoInterval }) {
    const r = await this.call<{ data: { referenceCode: string } }>("POST", `/v2/subscription/products/${encodeURIComponent(productRef)}/pricing-plans`, {
      locale: "tr",
      name: p.name,
      price: Number(p.price),
      currencyCode: "TRY",
      paymentInterval: p.interval,
      paymentIntervalCount: 1,
      planPaymentType: "RECURRING",
      // Deneme süresi yok: deneme içindeki salondan ilk ödeme hemen alınır (karar 05.11.2026).
    });
    return { referenceCode: r.data.referenceCode };
  }

  async initCheckout(p: { conversationId: string; callbackUrl: string; pricingPlanReferenceCode: string; customer: IyzicoCustomer }) {
    const r = await this.call<{ token: string; checkoutFormContent: string; tokenExpireTime?: number }>("POST", "/v2/subscription/checkoutform/initialize", {
      locale: "tr",
      conversationId: p.conversationId,
      callbackUrl: p.callbackUrl,
      pricingPlanReferenceCode: p.pricingPlanReferenceCode,
      subscriptionInitialStatus: "ACTIVE",
      customer: { ...p.customer, shippingAddress: p.customer.billingAddress },
    });
    return { token: r.token, checkoutFormContent: r.checkoutFormContent, tokenExpireTime: r.tokenExpireTime };
  }

  async retrieveCheckout(token: string) {
    const r = await this.call<{ data: IyzicoCheckoutResult }>("GET", `/v2/subscription/checkoutform/${encodeURIComponent(token)}`);
    return r.data;
  }

  async getSubscription(ref: string) {
    // Gerçek sandbox yanıtı aboneliği doğrudan "data" içinde döndürüyor (09.11.2026); doküman sayfalı "items" listesi gösteriyor. İkisi de desteklenir.
    const r = await this.call<{ data: IyzicoSubscriptionDetail & { items?: IyzicoSubscriptionDetail[] } }>("GET", `/v2/subscription/subscriptions/${encodeURIComponent(ref)}`);
    const item = r.data.items ? (r.data.items.find((i) => i.referenceCode === ref) ?? r.data.items[0]) : r.data.referenceCode === ref ? r.data : undefined;
    if (!item) throw new IyzicoError("Abonelik bulunamadı", "NOT_FOUND");
    return { ...item, orders: item.orders ?? [] };
  }

  async cancelSubscription(ref: string) {
    await this.call("POST", `/v2/subscription/subscriptions/${encodeURIComponent(ref)}/cancel`, {});
  }
}
