import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { IyzicoClient } from "../src/billing/iyzico/iyzico.client";
import { IyzicoPaymentProvider, PaymentProvider } from "../src/billing/payment-provider";
import { purgePurchaseRequests } from "../src/billing/purchase.service";
import { IyzicoBillingService } from "../src/billing/iyzico/iyzico-billing.service";
import { loadEnv } from "../src/config/env";
import { MockEmailProvider } from "../src/email/email.provider";
import { approvePrice, createApp, createTenantWithUser, login, owner, resetDb, TEST_PASSWORD, testPhone } from "./helpers";
import { DAY, FakeIyzico } from "./iyzico-fake";

const billing = { fullName: "Ayşe Yılmaz", identityNumber: "11111111111", gsmNumber: "0505 000 00 00", city: "Karaman", address: "Merkez Mah. 1. Sok. No:1" };
const terms = { acceptedTerms: true, termsVersion: "1.0 (07.11.2026)" };

describe("Siteden doğrudan paket satın alma (sahte iyzico ile)", () => {
  const su = owner();
  const fake = new FakeIyzico();
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  const env = loadEnv() as { PURCHASE_ENABLED?: string };

  /** E-postadaki satın alma bağlantısının belirteci */
  const mailToken = (email: string) => {
    const mail = [...app.get(MockEmailProvider).outbox].reverse().find((m: { to: string; subject: string }) => m.to === email && m.subject.startsWith("Paket satın alımınız"));
    return /satin-al\/odeme\?token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "")?.[1];
  };
  const form = (o: Partial<Record<string, unknown>> = {}) => ({
    businessName: "Işıl Güzellik",
    fullName: "Işıl Demir",
    email: "isil@test.local",
    phone: testPhone(),
    password: TEST_PASSWORD,
    planCode: "PROFESSIONAL",
    billingCycle: "MONTHLY",
    kvkkAccepted: true,
    termsAccepted: true,
    marketingConsent: false,
    elapsedMs: 15_000,
    ...o,
  });
  /** Form + doğrulama + ödeme formu; iyzico belirtecini döner */
  const startPurchase = async (o: Partial<Record<string, unknown>> = {}) => {
    const body = form(o);
    await http().post("/purchase").send(body).expect(202);
    const token = mailToken(String(body.email));
    expect(token).toBeTruthy();
    await http().post("/purchase/verify").send({ token }).expect(200);
    await http().post("/purchase/checkout").send({ token, billing, ...terms }).expect(200);
    return { token: token!, iyzToken: [...fake.checkouts.keys()].pop()!, body };
  };

  beforeAll(async () => {
    await resetDb(su);
    await approvePrice(su, "PROFESSIONAL", { monthly: 1000, yearly: 11000, vatRate: 20 });
    app = await createApp((b) => b.overrideProvider(IyzicoClient).useValue(fake).overrideProvider(PaymentProvider).useValue(new IyzicoPaymentProvider(() => true)));
  });
  afterAll(async () => {
    delete env.PURCHASE_ENABLED;
    await app.close();
    await su.$disconnect();
  });

  it("bayrak kapalıyken satın alma reddedilir; durum uç noktası kapalı der", async () => {
    env.PURCHASE_ENABLED = "0";
    try {
      expect((await http().get("/purchase/status").expect(200)).body.enabled).toBe(false);
      const r = await http().post("/purchase").send(form()).expect(403);
      expect(r.body.code).toBe("PURCHASE_DISABLED");
      expect(await su.purchaseRequest.count()).toBe(0);
    } finally {
      delete env.PURCHASE_ENABLED;
    }
    expect((await http().get("/purchase/status").expect(200)).body.enabled).toBe(true);
  });

  it("bot: gizli alan dolu ya da form çok hızlı gönderildiyse kayıt yazılmaz, e-posta gitmez (yanıt aynı)", async () => {
    const before = app.get(MockEmailProvider).outbox.length;
    await http().post("/purchase").send(form({ hp: "http://spam" })).expect(202);
    await http().post("/purchase").send(form({ elapsedMs: 500 })).expect(202);
    expect(await su.purchaseRequest.count()).toBe(0);
    expect(app.get(MockEmailProvider).outbox.length).toBe(before);
  });

  it("onaylı fiyatı olmayan paket ve zorunlu onaylar olmadan istek alınmaz", async () => {
    await http().post("/purchase").send(form({ planCode: "SMART" })).expect(409);
    await http().post("/purchase").send(form({ kvkkAccepted: false })).expect(400);
    await http().post("/purchase").send(form({ termsAccepted: undefined })).expect(400);
    expect(await su.purchaseRequest.count()).toBe(0);
  });

  it("e-posta doğrulanmadan ödeme formu açılmaz; doğrulamadan önce hiçbir hesap yok", async () => {
    await http().post("/purchase").send(form()).expect(202);
    const token = mailToken("isil@test.local")!;
    const r = await http().post("/purchase/checkout").send({ token, billing, ...terms }).expect(400);
    expect(r.body.message).toMatch(/e-posta/);
    expect(fake.checkouts.size).toBe(0);
    expect(await su.user.count({ where: { email: "isil@test.local" } })).toBe(0);
    const row = await su.purchaseRequest.findFirstOrThrow({ where: { email: "isil@test.local" } });
    expect(row.passwordHash).not.toContain(TEST_PASSWORD);
  });

  it("ödeme başarısız olursa hesap açılmaz; aynı bağlantıyla yeniden denenebilir", async () => {
    fake.failNextCheckout = true;
    const { iyzToken } = await startPurchase();
    fake.pay(iyzToken);
    fake.failNextCheckout = false;
    const r = await http().post("/billing/iyzico/callback").send({ token: iyzToken }).expect(200);
    expect(r.body.ok).toBe(false);
    expect(await su.user.count({ where: { email: "isil@test.local" } })).toBe(0);
    expect(await su.tenant.count({ where: { name: "Işıl Güzellik" } })).toBe(0);
    expect(fake.cancelled).toContain(`sub-${iyzToken}`);
    expect(await su.purchaseRequest.count({ where: { email: "isil@test.local" } })).toBe(1);
  });

  it("tutar uyuşmazsa hesap açılmaz ve iyzico aboneliği iptal edilir", async () => {
    await su.purchaseRequest.deleteMany();
    fake.chargeOverride = 1;
    const { iyzToken } = await startPurchase();
    fake.pay(iyzToken);
    fake.chargeOverride = null;
    expect((await http().post("/billing/iyzico/callback").send({ token: iyzToken }).expect(200)).body.ok).toBe(false);
    expect(await su.user.count({ where: { email: "isil@test.local" } })).toBe(0);
    expect(fake.cancelled).toContain(`sub-${iyzToken}`);
  });

  it("ödeme başarılı: işletme, sahip, onaylar ve aktif abonelik açılır; dönüş iki kez işlenmez; giriş yapılabilir", async () => {
    await su.purchaseRequest.deleteMany();
    const phone = testPhone();
    const { iyzToken } = await startPurchase({ phone, billingCycle: "YEARLY", marketingConsent: true });
    const co = fake.checkouts.get(iyzToken)!;
    expect(co.callbackUrl).toMatch(/\/api\/odeme\/iyzico\/satin-al$/);
    expect(co.customer.email).toBe("isil@test.local");
    // Ödemeden önce: hesap yok, fatura bilgisi saklanmıyor
    expect(await su.user.count({ where: { email: "isil@test.local" } })).toBe(0);
    const row = await su.iyzicoCheckout.findUniqueOrThrow({ where: { token: iyzToken } });
    expect(row.tenantId).toBeNull();
    expect(JSON.stringify(row)).not.toContain("11111111111");

    fake.pay(iyzToken);
    const r = await http().post("/billing/iyzico/callback").send({ token: iyzToken }).expect(200);
    expect(r.body.ok).toBe(true);
    await http().post("/billing/iyzico/callback").send({ token: iyzToken }).expect(200);

    const user = await su.user.findUniqueOrThrow({ where: { email: "isil@test.local" }, include: { memberships: { include: { tenant: true } }, consents: true } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.memberships).toHaveLength(1);
    const t = user.memberships[0].tenant;
    expect(user.memberships[0].role).toBe("OWNER");
    expect(t).toMatchObject({ name: "Işıl Güzellik", status: "ACTIVE", planCode: "PROFESSIONAL", phone: `+90${phone.slice(1)}`, trialEndsAt: null });
    expect(user.consents.map((c) => `${c.type}:${c.granted}`).sort()).toEqual(["KVKK_NOTICE:true", "MARKETING:true", "TERMS:true"]);
    const subs = await su.subscription.findMany({ where: { tenantId: t.id } });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ status: "ACTIVE", provider: "iyzico", billingCycle: "YEARLY" });
    expect(subs[0].priceAmount?.toFixed(2)).toBe("11000.00");
    const pays = await su.subscriptionPayment.findMany({ where: { tenantId: t.id } });
    expect(pays).toHaveLength(1);
    expect(pays[0].amount.toFixed(2)).toBe("13200.00");
    expect(await su.iyzicoCheckout.findUniqueOrThrow({ where: { token: iyzToken } })).toMatchObject({ status: "COMPLETED", tenantId: t.id, userId: user.id });
    // Bekleyen kayıt (parola özeti) silindi
    expect(await su.purchaseRequest.count({ where: { email: "isil@test.local" } })).toBe(0);
    expect(await su.auditLog.count({ where: { tenantId: t.id, action: "tenant.registered" } })).toBe(1);
    const outbox = app.get(MockEmailProvider).outbox as { to: string; subject: string }[];
    expect(outbox.some((m) => m.to === "isil@test.local" && m.subject.startsWith("Ödemeniz alındı"))).toBe(true);
    expect(outbox.some((m) => m.subject.startsWith("Yeni paket satışı"))).toBe(true);

    const tok = await login(app, "isil@test.local");
    const me = await http().get("/auth/me").set("Authorization", `Bearer ${tok}`).expect(200);
    expect(JSON.stringify(me.body)).toContain(t.id);
  });

  it("e-postası kayıtlı kişiye hesap açılmaz: aynı yanıt, bilgi e-postası gider", async () => {
    const r = await http().post("/purchase").send(form()).expect(202);
    expect(r.body.status).toBe("VERIFICATION_SENT");
    expect(await su.purchaseRequest.count({ where: { email: "isil@test.local" } })).toBe(0);
    const mail = [...app.get(MockEmailProvider).outbox].reverse().find((m: { to: string }) => m.to === "isil@test.local");
    expect(mail?.subject).toBe("ProGüzellik hesabınız zaten var");
  });

  it("açık bir işletmede kullanılan telefonla satın alma yapılamaz", async () => {
    const phone = testPhone();
    const A = await createTenantWithUser(su, { name: "Var Olan", email: "var@test.local" });
    await su.tenant.update({ where: { id: A.tenant.id }, data: { phone: `+90${phone.slice(1)}` } });
    const r = await http().post("/purchase").send(form({ email: "yeni@test.local", phone })).expect(409);
    expect(r.body.code).toBe("PHONE_IN_USE");
  });

  it("ödeme sürerken e-posta başka hesapta kullanılırsa: hesap açılmaz, iyzico iptal edilir, iade kaydı düşülür", async () => {
    const { iyzToken } = await startPurchase({ email: "yaris@test.local", businessName: "Yarış Salon" });
    await createTenantWithUser(su, { name: "Araya Giren", email: "yaris@test.local" });
    fake.pay(iyzToken);
    const r = await http().post("/billing/iyzico/callback").send({ token: iyzToken }).expect(200);
    expect(r.body.ok).toBe(false);
    expect(await su.tenant.count({ where: { name: "Yarış Salon" } })).toBe(0);
    expect(fake.cancelled).toContain(`sub-${iyzToken}`);
    expect(await su.auditLog.count({ where: { action: "purchase.conflict_refund_needed" } })).toBe(1);
  });

  it("dönüşü gelmeyen ödeme günlük eşitlemede tamamlanır ve hesap açılır", async () => {
    const { iyzToken } = await startPurchase({ email: "kayip@test.local", businessName: "Kayıp Dönüş" });
    fake.pay(iyzToken);
    const r = await app.get(IyzicoBillingService).reconcilePending(new Date(Date.now() + 120_000));
    expect(r.completed).toBe(1);
    const u = await su.user.findUniqueOrThrow({ where: { email: "kayip@test.local" }, include: { memberships: true } });
    expect(u.memberships).toHaveLength(1);
  });

  it("bir kayıtla sınırsız ödeme formu açılamaz", async () => {
    await http().post("/purchase").send(form({ email: "sinir@test.local" })).expect(202);
    const token = mailToken("sinir@test.local")!;
    await http().post("/purchase/verify").send({ token }).expect(200);
    for (let i = 0; i < 5; i++) await http().post("/purchase/checkout").send({ token, billing, ...terms }).expect(200);
    await http().post("/purchase/checkout").send({ token, billing, ...terms }).expect(429);
  });

  it("süresi dolmuş bekleyen kayıtlar silinir; geçersiz bağlantı reddedilir", async () => {
    await http().post("/purchase").send(form({ email: "eski@test.local" })).expect(202);
    const token = mailToken("eski@test.local")!;
    await su.purchaseRequest.updateMany({ where: { email: "eski@test.local" }, data: { expiresAt: new Date(Date.now() - DAY) } });
    await http().post("/purchase/verify").send({ token }).expect(404);
    await purgePurchaseRequests(su, new Date());
    expect(await su.purchaseRequest.count({ where: { email: "eski@test.local" } })).toBe(0);
    await http().post("/purchase/verify").send({ token: "x".repeat(40) }).expect(404);
  });

  it("iyzico'da ürün zaten varsa (kaydı bizde yok) aynı ürün kullanılır", async () => {
    await su.iyzicoCheckout.deleteMany();
    await su.iyzicoPlanLink.deleteMany();
    const products = fake.products.length;
    await startPurchase({ email: "urun@test.local", businessName: "Ürün Salon" });
    expect(fake.products.length).toBe(products);
    expect(await su.iyzicoPlanLink.count()).toBe(1);
    // Aynı adlı ödeme planı da yeniden kullanıldı (tutar ve dönem aynı)
    const plans = fake.plans.length;
    await su.iyzicoCheckout.deleteMany();
    await su.iyzicoPlanLink.deleteMany();
    await startPurchase({ email: "urun2@test.local", businessName: "Ürün Salon 2" });
    expect(fake.plans.length).toBe(plans);
  });
});
