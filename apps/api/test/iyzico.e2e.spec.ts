import { INestApplication } from "@nestjs/common";
import { createHmac } from "node:crypto";
import request from "supertest";
import { IyzicoBillingService } from "../src/billing/iyzico/iyzico-billing.service";
import { HttpIyzicoClient, IyzicoClient, iyzicoAuthHeader, verifyIyzicoSubscriptionSignature } from "../src/billing/iyzico/iyzico.client";
import { DAY, FakeIyzico } from "./iyzico-fake";
import { DisabledPaymentProvider, IyzicoPaymentProvider, MockPaymentProvider, PaymentProvider, paymentProviderFor } from "../src/billing/payment-provider";
import { SubscriptionsService } from "../src/billing/subscriptions.service";
import { loadEnv } from "../src/config/env";
import { api, approvePrice, createApp, createTenantWithUser, login, owner, resetDb } from "./helpers";

const MERCHANT = "3404590";
const SECRET = "sandbox-test-secret";

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

  it("canlıda pilot listesi varsa yalnız iyzico açılır; listede olmayan işletme ödeme ekranı açamaz", () => {
    const p = paymentProviderFor({ NODE_ENV: "production", PAYMENT_MODE: "iyzico", IYZICO_PILOT_TENANTS: "11111111-1111-4111-8111-111111111111" }, () => true);
    expect(p).toBeInstanceOf(IyzicoPaymentProvider);
    expect(paymentProviderFor({ NODE_ENV: "production", PAYMENT_MODE: "mock", IYZICO_PILOT_TENANTS: "11111111-1111-4111-8111-111111111111" }, () => true)).toBeInstanceOf(DisabledPaymentProvider);
    expect(paymentProviderFor({ NODE_ENV: "production", PAYMENT_MODE: "iyzico", IYZICO_PILOT_TENANTS: " " }, () => true)).toBeInstanceOf(DisabledPaymentProvider);
    const env = loadEnv() as { NODE_ENV: string; IYZICO_PILOT_TENANTS?: string };
    const saved = { NODE_ENV: env.NODE_ENV, P: env.IYZICO_PILOT_TENANTS, R: process.env.NODE_ENV };
    try {
      process.env.NODE_ENV = "production";
      env.NODE_ENV = "production";
      env.IYZICO_PILOT_TENANTS = "11111111-1111-4111-8111-111111111111";
      expect(p.acceptsPayments).toBe(true);
      const svc = Object.create(IyzicoBillingService.prototype) as IyzicoBillingService;
      expect(svc.allowedFor("11111111-1111-4111-8111-111111111111")).toBe(true);
      expect(svc.allowedFor("22222222-2222-4222-8222-222222222222")).toBe(false);
      env.IYZICO_PILOT_TENANTS = "*";
      expect(svc.allowedFor("22222222-2222-4222-8222-222222222222")).toBe(true);
      expect(paymentProviderFor({ NODE_ENV: "production", PAYMENT_MODE: "iyzico", IYZICO_PILOT_TENANTS: "*" }, () => true)).toBeInstanceOf(IyzicoPaymentProvider);
    } finally {
      process.env.NODE_ENV = saved.R;
      env.NODE_ENV = saved.NODE_ENV;
      env.IYZICO_PILOT_TENANTS = saved.P;
    }
  });

  it("canlıda pilot listesi yoksa online ödeme kapalı; canlı adres yalnız canlı anahtarla çalışır", () => {
    expect(paymentProviderFor({ NODE_ENV: "production", PAYMENT_MODE: "iyzico" }, () => true)).toBeInstanceOf(DisabledPaymentProvider);
    expect(paymentProviderFor({ NODE_ENV: "development", PAYMENT_MODE: "iyzico" }, () => true)).toBeInstanceOf(IyzicoPaymentProvider);
    expect(paymentProviderFor({ NODE_ENV: "development", PAYMENT_MODE: "iyzico" }, () => false).acceptsPayments).toBe(false);
    const env = loadEnv() as { IYZICO_API_KEY?: string; IYZICO_SECRET_KEY?: string; IYZICO_BASE_URL: string };
    const saved = { ...env };
    try {
      Object.assign(env, { IYZICO_API_KEY: "k", IYZICO_SECRET_KEY: "s", IYZICO_BASE_URL: "https://api.iyzipay.com" });
      expect(new HttpIyzicoClient().environment).toBe("live");
      Object.assign(env, { IYZICO_API_KEY: "sandbox-k", IYZICO_SECRET_KEY: "sandbox-s" });
      expect(new HttpIyzicoClient().environment).toBeNull();
      env.IYZICO_BASE_URL = "https://example.com";
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
  const billingInfo = { fullName: "Ayşe Yılmaz", identityNumber: "11111111111", gsmNumber: "0505 000 00 00", city: "Karaman", address: "Merkez Mah. 1. Sok. No:1" };
  const terms = { acceptedTerms: true, termsVersion: "1.0 (07.11.2026)" };

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
    await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: { ...billingInfo, identityNumber: "12" }, ...terms }).expect(400);
    expect(fake.checkouts.size).toBe(0);
  });

  it("ödeme formu: iyzico planı KDV dahil tutarla ve denemesiz açılır, tekrar kullanılır", async () => {
    const r = await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, ...terms }).expect(201);
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
    await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, ...terms }).expect(201);
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
    await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, ...terms }).expect(201);
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
    const r = await a.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "YEARLY", billing: billingInfo, ...terms }).expect(409);
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
    await b.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, ...terms }).expect(201);
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

  it("sözleşme onayı olmadan form açılmaz; onay sürümü denetim kaydına yazılır", async () => {
    const D = await createTenantWithUser(su, { name: "Onay Salon", email: "onay@test.local", status: "TRIAL" });
    const d = api(app, await login(app, "onay@test.local"), D.tenant.id);
    await d.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo }).expect(400);
    await d.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, acceptedTerms: false, termsVersion: "1.0" }).expect(400);
    await d.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, ...terms }).expect(201);
    const log = await su.auditLog.findFirstOrThrow({ where: { tenantId: D.tenant.id, action: "iyzico.checkout_started" } });
    expect((log.metadata as { termsAccepted: { version: string } }).termsAccepted.version).toBe("1.0 (07.11.2026)");
  });

  it("dönüş hiç gelmezse: ödenmiş oturum günlük görevde açılır, ödenmemiş eski oturum kapanır", async () => {
    const E = await createTenantWithUser(su, { name: "Donus Salon", email: "donus@test.local", status: "TRIAL" });
    const e = api(app, await login(app, "donus@test.local"), E.tenant.id);
    await e.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, ...terms }).expect(201);
    const paidTok = [...fake.checkouts.keys()].pop()!;
    await e.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, ...terms }).expect(201);
    const unpaidTok = [...fake.checkouts.keys()].pop()!;
    const ref = fake.pay(paidTok);
    await subs.runLifecycle(new Date(Date.now() + 2 * 3_600_000));
    const s = await su.subscription.findFirstOrThrow({ where: { tenantId: E.tenant.id, status: "ACTIVE" } });
    expect(s.providerRef).toBe(ref);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: E.tenant.id } })).status).toBe("ACTIVE");
    expect((await su.iyzicoCheckout.findUniqueOrThrow({ where: { token: unpaidTok } })).status).toBe("FAILED");
  });

  it("ilk çekim bildirimi dönüşten önce gelirse oturum tamamlanır", async () => {
    const F = await createTenantWithUser(su, { name: "Bildirim Salon", email: "bildirim@test.local", status: "TRIAL" });
    const f = api(app, await login(app, "bildirim@test.local"), F.tenant.id);
    await f.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, ...terms }).expect(201);
    const tk = [...fake.checkouts.keys()].pop()!;
    const ref = fake.pay(tk);
    const order = fake.subs.get(ref)!.orders[0].referenceCode;
    const body = { orderReferenceCode: order, customerReferenceCode: `cus-${tk}`, subscriptionReferenceCode: ref, iyziReferenceCode: "evt-first", iyziEventType: "subscription.order.success" };
    await http().post("/billing/iyzico/webhook").set("X-IYZ-SIGNATURE-V3", sign(body.iyziEventType, ref, order, body.customerReferenceCode)).send(body).expect(200);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: F.tenant.id } })).status).toBe("ACTIVE");
    expect(await su.subscriptionPayment.count({ where: { tenantId: F.tenant.id } })).toBe(1);
  });

  it("iyzico aboneliği açıldı ama ilk ödeme başarısızsa: referans saklanır ve iyzico'da iptal edilir", async () => {
    const G = await createTenantWithUser(su, { name: "Basarisiz Salon", email: "basarisiz@test.local", status: "TRIAL" });
    const g = api(app, await login(app, "basarisiz@test.local"), G.tenant.id);
    await g.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: billingInfo, ...terms }).expect(201);
    const tk = [...fake.checkouts.keys()].pop()!;
    const ref = fake.pay(tk);
    fake.subs.get(ref)!.orders[0].orderStatus = "FAILED";
    expect((await http().post("/billing/iyzico/callback").send({ token: tk }).expect(200)).body.ok).toBe(false);
    expect(fake.cancelled).toContain(ref);
    expect((await su.iyzicoCheckout.findUniqueOrThrow({ where: { token: tk } })).subscriptionReferenceCode).toBe(ref);
  });

  it("yıllık paket ayrı iyzico planıyla satılır", async () => {
    const C = await createTenantWithUser(su, { name: "Yillik Salon", email: "yil@test.local", status: "TRIAL" });
    const c = api(app, await login(app, "yil@test.local"), C.tenant.id);
    const r = await c.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "YEARLY", billing: billingInfo, ...terms }).expect(201);
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
      const r = await t.post("/subscription/iyzico/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", billing: { fullName: "Ad Soyad", identityNumber: "11111111111", gsmNumber: "05050000000", city: "Karaman", address: "Adres 12345" }, acceptedTerms: true, termsVersion: "1.0" });
      expect(r.status).toBe(503);
    } finally {
      await app.close();
      await su.$disconnect();
    }
  });
});
