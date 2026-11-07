import { INestApplication } from "@nestjs/common";
import { createHmac } from "node:crypto";
import request from "supertest";
import { IyzicoBillingService } from "../src/billing/iyzico/iyzico-billing.service";
import { HttpIyzicoClient, IyzicoClient, IyzicoCustomer, IyzicoInterval, IyzicoSubscriptionDetail, iyzicoAuthHeader, verifyIyzicoSubscriptionSignature } from "../src/billing/iyzico/iyzico.client";
import { DisabledPaymentProvider, IyzicoPaymentProvider, MockPaymentProvider, PaymentProvider, paymentProviderFor } from "../src/billing/payment-provider";
import { SubscriptionsService } from "../src/billing/subscriptions.service";
import { loadEnv } from "../src/config/env";
import { api, approvePrice, createApp, createTenantWithUser, login, owner, resetDb } from "./helpers";

const DAY = 86_400_000;
const MERCHANT = "3404590";
const SECRET = "sandbox-test-secret";

/** Sahte iyzico: gerçek ağ çağrısı yapılmaz. Siparişler (çekimler) test içinden eklenir. */
class FakeIyzico extends IyzicoClient {
  products: { ref: string; name: string }[] = [];
  plans: { ref: string; productRef: string; name: string; price: string; interval: IyzicoInterval }[] = [];
  checkouts = new Map<string, { plan: string; customer: IyzicoCustomer; callbackUrl: string }>();
  subs = new Map<string, IyzicoSubscriptionDetail>();
  cancelled: string[] = [];
  /** Ödeme formunda çekilecek tutar (tutar uyuşmazlığı testi için değiştirilir) */
  chargeOverride: number | null = null;
  failNextCheckout = false;
  private n = 0;
  get environment() {
    return "sandbox" as const;
  }
  async createProduct(name: string) {
    const ref = `prod-${++this.n}`;
    this.products.push({ ref, name });
    return { referenceCode: ref };
  }
  async createPricingPlan(productRef: string, p: { name: string; price: string; interval: IyzicoInterval }) {
    const ref = `plan-${++this.n}`;
    this.plans.push({ ref, productRef, ...p });
    return { referenceCode: ref };
  }
  async initCheckout(p: { conversationId: string; callbackUrl: string; pricingPlanReferenceCode: string; customer: IyzicoCustomer }) {
    const token = `tok-${++this.n}-abcdefghij`;
    this.checkouts.set(token, { plan: p.pricingPlanReferenceCode, customer: p.customer, callbackUrl: p.callbackUrl });
    return { token, checkoutFormContent: `<script>/*iyzico ${token}*/</script>` };
  }
  /** Kullanıcının iyzico formunda ödemeyi tamamlaması */
  pay(token: string) {
    const c = this.checkouts.get(token)!;
    const plan = this.plans.find((p) => p.ref === c.plan)!;
    const ref = `sub-${token}`;
    const start = Date.now();
    const end = plan.interval === "MONTHLY" ? start + 30 * DAY : start + 365 * DAY;
    this.subs.set(ref, {
      referenceCode: ref,
      customerReferenceCode: `cus-${token}`,
      pricingPlanReferenceCode: plan.ref,
      subscriptionStatus: this.failNextCheckout ? "UNPAID" : "ACTIVE",
      orders: this.failNextCheckout ? [] : [{ referenceCode: `ord-${token}-1`, price: this.chargeOverride ?? Number(plan.price), startPeriod: start, endPeriod: end, orderStatus: "SUCCESS" }],
    });
    return ref;
  }
  addOrder(ref: string, o: { status: "SUCCESS" | "FAILED"; start: number; end: number; price?: number }) {
    const s = this.subs.get(ref)!;
    const plan = this.plans.find((p) => p.ref === s.pricingPlanReferenceCode)!;
    const id = `ord-${ref}-${s.orders.length + 1}`;
    s.orders.push({ referenceCode: id, price: o.price ?? Number(plan.price), startPeriod: o.start, endPeriod: o.end, orderStatus: o.status });
    return id;
  }
  async retrieveCheckout(token: string) {
    const ref = `sub-${token}`;
    const s = this.subs.get(ref);
    if (!s) return { referenceCode: ref, pricingPlanReferenceCode: this.checkouts.get(token)!.plan, subscriptionStatus: "PENDING" };
    return { referenceCode: ref, customerReferenceCode: s.customerReferenceCode, pricingPlanReferenceCode: s.pricingPlanReferenceCode, subscriptionStatus: s.subscriptionStatus };
  }
  async getSubscription(ref: string) {
    return structuredClone(this.subs.get(ref)!);
  }
  async cancelSubscription(ref: string) {
    this.cancelled.push(ref);
    const s = this.subs.get(ref);
    if (s) s.subscriptionStatus = "CANCELED";
  }
}

const sign = (eventType: string, sub: string, order: string, customer: string) =>
  createHmac("sha256", SECRET).update(MERCHANT + SECRET + eventType + sub + order + customer).digest("hex");

describe("iyzico (birim)", () => {
  it("IYZWSv2 başlığı: HMACSHA256(randomKey + yol + gövde) hex, base64 içinde apiKey/randomKey/signature", () => {
    const h = iyzicoAuthHeader("sandbox-key", "sandbox-secret", "123456789", "/payment/bin/check", '{"binNumber":"589004"}');
    expect(h.startsWith("IYZWSv2 ")).toBe(true);
    const decoded = Buffer.from(h.slice(8), "base64").toString();
    const sig = createHmac("sha256", "sandbox-secret").update('123456789/payment/bin/check{"binNumber":"589004"}').digest("hex");
    expect(decoded).toBe(`apiKey:sandbox-key&randomKey:123456789&signature:${sig}`);
  });

  it("abonelik bildirimi imzası doğrulanır; yanlış imza reddedilir", () => {
    const p = { merchantId: MERCHANT, secretKey: SECRET, eventType: "subscription.order.success", subscriptionReferenceCode: "s", orderReferenceCode: "o", customerReferenceCode: "c" };
    expect(verifyIyzicoSubscriptionSignature(p, sign(p.eventType, "s", "o", "c"))).toBe(true);
    expect(verifyIyzicoSubscriptionSignature(p, sign(p.eventType, "s", "o2", "c"))).toBe(false);
    expect(verifyIyzicoSubscriptionSignature(p, "abc")).toBe(false);
  });

  it("canlıda iyzico dahil online ödeme kapalı; canlı iyzico adresi bu sürümde yapılandırılmış sayılmaz", () => {
    expect(paymentProviderFor({ NODE_ENV: "production", PAYMENT_MODE: "iyzico" }, () => true)).toBeInstanceOf(DisabledPaymentProvider);
    expect(paymentProviderFor({ NODE_ENV: "development", PAYMENT_MODE: "iyzico" }, () => true)).toBeInstanceOf(IyzicoPaymentProvider);
    expect(paymentProviderFor({ NODE_ENV: "development", PAYMENT_MODE: "iyzico" }, () => false).acceptsPayments).toBe(false);
    const env = loadEnv() as { IYZICO_API_KEY?: string; IYZICO_SECRET_KEY?: string; IYZICO_BASE_URL: string };
    const saved = { ...env };
    try {
      Object.assign(env, { IYZICO_API_KEY: "k", IYZICO_SECRET_KEY: "s", IYZICO_BASE_URL: "https://api.iyzipay.com" });
      expect(new HttpIyzicoClient().environment).toBeNull();
      env.IYZICO_BASE_URL = "https://sandbox-api.iyzipay.com";
      expect(new HttpIyzicoClient().environment).toBe("sandbox");
    } finally {
      Object.assign(env, saved);
    }
  });
});

describe("iyzico Abonelik akışı (sahte iyzico ile)", () => {
  const su = owner();
  const fake = new FakeIyzico();
  let app: INestApplication;
  let subs: SubscriptionsService;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  const http = () => request(app.getHttpServer());
  const env = loadEnv() as { IYZICO_SECRET_KEY?: string; IYZICO_MERCHANT_ID?: string };
  const billing = { fullName: "Ayşe Yılmaz", identityNumber: "11111111111", gsmNumber: "0505 000 00 00", city: "Karaman", address: "Merkez Mah. 1. Sok. No:1" };

  beforeAll(async () => {
    await resetDb(su);
    env.IYZICO_SECRET_KEY = SECRET;
    env.IYZICO_MERCHANT_ID = MERCHANT;
    A = await createTenantWithUser(su, { name: "iyzico Salon", email: "iyz@test.local", status: "TRIAL" });
    await approvePrice(su, "PROFESSIONAL", { monthly: 1000, yearly: 11000, vatRate: 20 });
    app = await createApp((b) => b.overrideProvider(IyzicoClient).useValue(fake).overrideProvider(PaymentProvider).useValue(new IyzicoPaymentProvider(() => true)));
    subs = app.get(SubscriptionsService);
    a = api(app, await login(app, "iyz@test.local"), A.tenant.id);
  });
  afterAll(async () => {
    delete env.IYZICO_SECRET_KEY;
    delete env.IYZICO_MERCHANT_ID;
    await app.close();
    await su.$disconnect();
  });

  let token = "";
  let subRef = "";

  it("panel iyzico ödeme formunu bildirir; test belirteciyle ödeme reddedilir", async () => {
    const s = await a.get("/subscription").expect(200);
    expect(s.body.onlinePayment).toBe(true);
    expect(s.body.checkoutKind).toBe("iyzico");
    const r = await a.post("/subscription/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(409);
    expect(r.body.code).toBe("USE_IYZICO_CHECKOUT");
  });

  it("fatura bilgisi eksik/yanlışsa form açılmaz", async () => {
    await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: { ...billing, identityNumber: "12" } }).expect(400);
    expect(fake.checkouts.size).toBe(0);
  });

  it("ödeme formu: iyzico planı KDV dahil tutarla ve denemesiz açılır, tekrar kullanılır", async () => {
    const r = await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing }).expect(201);
    expect(r.body).toMatchObject({ amount: "1200.00", netAmount: "1000.00", vatRate: "20.00" });
    expect(r.body.checkoutFormContent).toContain("<script>");
    expect(fake.plans).toHaveLength(1);
    expect(fake.plans[0]).toMatchObject({ price: "1200.00", interval: "MONTHLY" });
    token = [...fake.checkouts.keys()][0];
    const c = fake.checkouts.get(token)!;
    expect(c.customer).toMatchObject({ name: "Ayşe", surname: "Yılmaz", gsmNumber: "+905050000000", email: "iyz@test.local" });
    expect(c.callbackUrl).toMatch(/\/api\/odeme\/iyzico\/donus$/);
    // Fatura bilgisi bizde saklanmaz
    const row = await su.iyzicoCheckout.findUniqueOrThrow({ where: { token } });
    expect(JSON.stringify(row)).not.toContain("11111111111");
    await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing }).expect(201);
    expect(fake.plans).toHaveLength(1);
    expect(fake.products).toHaveLength(1);
  });

  it("bilinmeyen token ve ödenmemiş form abonelik açmaz", async () => {
    expect((await http().post("/billing/iyzico/callback").send({ token: "bilinmeyen-token-123" }).expect(200)).body.ok).toBe(false);
    const r = await http().post("/billing/iyzico/callback").send({ token }).expect(200);
    expect(r.body.ok).toBe(false);
    expect(await su.subscription.count({ where: { tenantId: A.tenant.id } })).toBe(0);
  });

  it("ödeme tamamlanınca: sonuç iyzico'dan doğrulanır, abonelik açılır, aynı dönüş iki kez işlenmez", async () => {
    // önceki test bu oturumu başarısız kapattı; yeni oturum açılır
    await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing }).expect(201);
    token = [...fake.checkouts.keys()].pop()!;
    subRef = fake.pay(token);
    const r = await http().post("/billing/iyzico/callback").send({ token }).expect(200);
    expect(r.body.ok).toBe(true);
    await http().post("/billing/iyzico/callback").send({ token }).expect(200);
    const t = await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } });
    expect(t.status).toBe("ACTIVE");
    const s = await su.subscription.findFirstOrThrow({ where: { tenantId: A.tenant.id, status: "ACTIVE" } });
    expect(s).toMatchObject({ provider: "iyzico", providerRef: subRef, billingCycle: "MONTHLY" });
    expect(s.priceAmount?.toFixed(2)).toBe("1000.00");
    const pays = await su.subscriptionPayment.findMany({ where: { subscriptionId: s.id } });
    expect(pays).toHaveLength(1);
    expect(pays[0].amount.toFixed(2)).toBe("1200.00");
    expect(await su.savedPaymentMethod.count({ where: { tenantId: A.tenant.id } })).toBe(0);
  });

  it("aktif abonelik varken yeni ödeme formu açılmaz", async () => {
    const r = await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "YEARLY", billing }).expect(409);
    expect(r.body.code).toBe("SUBSCRIPTION_ACTIVE");
  });

  it("bildirim: imzasız/yanlış imzalı reddedilir; geçerli bildirim durumu iyzico'dan okur, tekrar gelirse işlenmez", async () => {
    const s = await su.subscription.findFirstOrThrow({ where: { providerRef: subRef } });
    const order = fake.addOrder(subRef, { status: "SUCCESS", start: s.currentPeriodEnd.getTime(), end: s.currentPeriodEnd.getTime() + 30 * DAY });
    const body = { orderReferenceCode: order, customerReferenceCode: `cus-${token}`, subscriptionReferenceCode: subRef, iyziReferenceCode: "evt-1", iyziEventType: "subscription.order.success", iyziEventTime: Date.now() };
    await http().post("/billing/iyzico/webhook").send(body).expect(403);
    await http().post("/billing/iyzico/webhook").set("X-IYZ-SIGNATURE-V3", "00").send(body).expect(403);
    const sig = sign(body.iyziEventType, subRef, order, body.customerReferenceCode);
    await http().post("/billing/iyzico/webhook").set("X-IYZ-SIGNATURE-V3", sig).send(body).expect(200);
    await http().post("/billing/iyzico/webhook").set("X-IYZ-SIGNATURE-V3", sig).send(body).expect(200);
    const after = await su.subscription.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.currentPeriodEnd.getTime()).toBe(s.currentPeriodEnd.getTime() + 30 * DAY);
    expect(await su.subscriptionPayment.count({ where: { subscriptionId: s.id, status: "PAID" } })).toBe(2);
  });

  it("günlük görev iyzico aboneliğinde çekim denemez; dönem bitip ödeme yoksa ödeme bekliyor olur, sonraki başarılı çekim yeniden açar", async () => {
    const s = await su.subscription.findFirstOrThrow({ where: { providerRef: subRef } });
    const r = await subs.runLifecycle(new Date(s.currentPeriodEnd.getTime() + DAY));
    expect(r.renewalFailed).toBe(1);
    expect((await su.subscription.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PAST_DUE");
    expect((await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } })).status).toBe("PAST_DUE");
    expect(await su.subscriptionPayment.count({ where: { subscriptionId: s.id, status: "FAILED" } })).toBe(0);
    fake.addOrder(subRef, { status: "SUCCESS", start: s.currentPeriodEnd.getTime(), end: s.currentPeriodEnd.getTime() + 30 * DAY });
    const r2 = await subs.runLifecycle(new Date(s.currentPeriodEnd.getTime() + 2 * DAY));
    expect(r2.renewed).toBe(1);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } })).status).toBe("ACTIVE");
  });

  it("iptal: iyzico'da sonraki çekimler durdurulur, erişim dönem sonuna kadar sürer", async () => {
    await a.post("/subscription/cancel").expect(200);
    expect(fake.cancelled).toContain(subRef);
    const s = await su.subscription.findFirstOrThrow({ where: { providerRef: subRef } });
    expect(s).toMatchObject({ status: "ACTIVE", cancelAtPeriodEnd: true });
  });

  it("tutar uyuşmazlığında abonelik açılmaz ve iyzico aboneliği iptal edilir", async () => {
    const B = await createTenantWithUser(su, { name: "Tutar Salon", email: "tutar@test.local", status: "TRIAL" });
    const b = api(app, await login(app, "tutar@test.local"), B.tenant.id);
    await b.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing }).expect(201);
    const tk = [...fake.checkouts.keys()].pop()!;
    fake.chargeOverride = 1.0;
    const ref = fake.pay(tk);
    fake.chargeOverride = null;
    const r = await http().post("/billing/iyzico/callback").send({ token: tk }).expect(200);
    expect(r.body.ok).toBe(false);
    expect(fake.cancelled).toContain(ref);
    expect(await su.subscription.count({ where: { tenantId: B.tenant.id } })).toBe(0);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: B.tenant.id } })).status).toBe("TRIAL");
  });

  it("yıllık paket ayrı iyzico planıyla satılır", async () => {
    const C = await createTenantWithUser(su, { name: "Yillik Salon", email: "yil@test.local", status: "TRIAL" });
    const c = api(app, await login(app, "yil@test.local"), C.tenant.id);
    const r = await c.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "YEARLY", billing }).expect(201);
    expect(r.body.amount).toBe("13200.00");
    expect(fake.plans.find((p) => p.interval === "YEARLY")?.price).toBe("13200.00");
    expect(app.get(IyzicoBillingService).enabled).toBe(true);
  });
});

describe("iyzico kapalıyken", () => {
  it("test sağlayıcısında iyzico uç noktası 503 döner", async () => {
    const su = owner();
    await resetDb(su);
    const T = await createTenantWithUser(su, { name: "Kapali Salon", email: "kapali@test.local", status: "TRIAL" });
    const app = await createApp((b) => b.overrideProvider(PaymentProvider).useValue(new MockPaymentProvider()));
    try {
      const t = api(app, await login(app, "kapali@test.local"), T.tenant.id);
      const r = await t.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: { fullName: "Ad Soyad", identityNumber: "11111111111", gsmNumber: "05050000000", city: "Karaman", address: "Adres 12345" } });
      expect(r.status).toBe(503);
    } finally {
      await app.close();
      await su.$disconnect();
    }
  });
});
