import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { DisabledPaymentProvider, MockPaymentProvider, PaymentProvider, paymentProviderFor } from "../src/billing/payment-provider";
import { JobsService } from "../src/jobs/jobs.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { api, createApp, createTenantWithUser, enableMfa, login, owner, resetDb, TEST_PASSWORD } from "./helpers";

const DAY = 86_400_000;
const rid = () => randomUUID();

describe("Canlıda test ödemesi kapalı", () => {
  it("canlı ortamda sağlayıcı seçimi her zaman 'ödeme kapalı'dır", () => {
    expect(paymentProviderFor({ NODE_ENV: "production", PAYMENT_MODE: "mock" })).toBeInstanceOf(DisabledPaymentProvider);
    expect(paymentProviderFor({ NODE_ENV: "test", PAYMENT_MODE: "mock" })).toBeInstanceOf(MockPaymentProvider);
    expect(new DisabledPaymentProvider().acceptsPayments).toBe(false);
  });

  it("test sağlayıcısı yanlışlıkla canlıda çalışsa bile tok_test 'ödendi' sayılmaz", async () => {
    const prev = process.env.NODE_ENV;
    const mock = new MockPaymentProvider();
    try {
      process.env.NODE_ENV = "production";
      expect(mock.acceptsPayments).toBe(false);
      const r = await mock.charge({ tenantId: rid(), amount: "100.00", currency: "TRY", description: "x", paymentToken: "tok_test", idempotencyKey: rid() });
      expect(r.ok).toBe(false);
      expect(mock.charges).toHaveLength(0);
    } finally {
      process.env.NODE_ENV = prev;
    }
    expect(mock.acceptsPayments).toBe(true);
  });

  describe("ödeme kapalıyken API", () => {
    const su = owner();
    let app: INestApplication;
    let T: Awaited<ReturnType<typeof createTenantWithUser>>;
    let t: ReturnType<typeof api>;

    beforeAll(async () => {
      await resetDb(su);
      T = await createTenantWithUser(su, { name: "Canli Salon", email: "canli@test.local", status: "TRIAL" });
      app = await createApp((b) => b.overrideProvider(PaymentProvider).useValue(new DisabledPaymentProvider()));
      t = api(app, await login(app, "canli@test.local"), T.tenant.id);
    });
    afterAll(async () => {
      await app.close();
      await su.$disconnect();
    });

    it("checkout (tok_test dahil) 503 döner; abonelik, ödeme veya kayıtlı kart oluşmaz, durum değişmez", async () => {
      for (const token of ["tok_test", "tok_ok", "anything"]) {
        const r = await t.post("/subscription/checkout").send({ planCode: "SMART", billingCycle: "YEARLY", paymentToken: token }).expect(503);
        expect(r.body.code).toBe("ONLINE_PAYMENT_DISABLED");
      }
      expect(await su.subscription.count({ where: { tenantId: T.tenant.id } })).toBe(0);
      expect(await su.subscriptionPayment.count({ where: { tenantId: T.tenant.id } })).toBe(0);
      expect(await su.savedPaymentMethod.count({ where: { tenantId: T.tenant.id } })).toBe(0);
      expect((await su.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).status).toBe("TRIAL");
    });

    it("abonelik sayfası online ödemenin kapalı olduğunu bildirir", async () => {
      const r = await t.get("/subscription").expect(200);
      expect(r.body.onlinePayment).toBe(false);
    });

    it("eski test kartlı abonelik yenilemede 'ödendi' sayılmaz; tahsilat denenmez, PAST_DUE olur", async () => {
      const end = new Date(Date.now() - 1000);
      const sub = await su.subscription.create({
        data: { tenantId: T.tenant.id, planCode: "PROFESSIONAL", billingCycle: "MONTHLY", currentPeriodStart: new Date(end.getTime() - 30 * DAY), currentPeriodEnd: end, provider: "mock" },
      });
      await su.savedPaymentMethod.create({ data: { tenantId: T.tenant.id, provider: "mock", token: "tok_test" } });
      await su.tenant.update({ where: { id: T.tenant.id }, data: { status: "ACTIVE" } });
      const res = await app.get(JobsService).runDaily({ now: new Date(), force: true });
      expect((res as any).result.renewalFailed).toBe(1);
      const payments = await su.subscriptionPayment.findMany({ where: { subscriptionId: sub.id } });
      expect(payments.map((p) => p.status)).toEqual(["FAILED"]);
      expect((await su.subscription.findUniqueOrThrow({ where: { id: sub.id } })).status).toBe("PAST_DUE");
      expect((await su.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).status).toBe("PAST_DUE");
    });
  });
});

describe("SaaS sahibi: manuel abonelik", () => {
  const su = owner();
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let prisma: PrismaService;

  const create = (tenantId: string, body: Record<string, unknown> = {}) =>
    admin.post(`/platform/tenants/${tenantId}/subscriptions`).send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", complimentary: true, note: "Açılış hediyesi", requestId: rid(), ...body });
  const newTenant = (name: string, status: "TRIAL" | "ACTIVE" = "TRIAL") => createTenantWithUser(su, { name, email: `${name.toLowerCase().replace(/\s/g, "")}@test.local`, status });

  beforeAll(async () => {
    await resetDb(su);
    A = await newTenant("Salon A");
    await su.user.create({
      data: { email: "admin@proguzellik.test", fullName: "Platform Sahibi", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true },
    });
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = api(app, (await enableMfa(app, "admin@proguzellik.test")).token);
    a = api(app, await login(app, "salona@test.local"), A.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  describe("yetki", () => {
    it("işletme sahibi ve oturumsuz istek manuel abonelik uç noktalarına erişemez", async () => {
      const sub = await su.subscription.create({
        data: { tenantId: A.tenant.id, planCode: "STARTER", billingCycle: "MONTHLY", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + DAY), provider: "manual", source: "MANUAL", status: "CANCELLED" },
      });
      const body = { planCode: "SMART", billingCycle: "YEARLY", complimentary: true, note: "kendime hediye", requestId: rid(), days: 300, mode: "immediate" };
      await a.post(`/platform/tenants/${A.tenant.id}/subscriptions`).send(body).expect(403);
      for (const op of ["extend", "renew", "plan", "cancel"]) await a.post(`/platform/subscriptions/${sub.id}/${op}`).send(body).expect(403);
      await request(app.getHttpServer()).post(`/platform/tenants/${A.tenant.id}/subscriptions`).send(body).expect(401);
      expect(await su.subscriptionGrant.count()).toBe(0);
      expect((await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } })).status).toBe("TRIAL");
      await su.subscription.delete({ where: { id: sub.id } });
    });

    it("işletme rolü defteri okuyamaz; platform rolü defteri değiştiremez/silemez", async () => {
      await expect(prisma.withTenant({ tenantId: A.tenant.id, userId: A.user.id }, (tx) => tx.subscriptionGrant.findMany())).rejects.toThrow(/permission denied/);
      const T = await newTenant("Defter");
      const r = await create(T.tenant.id).expect(200);
      await expect(prisma.platform.subscriptionGrant.update({ where: { id: r.body.grant.id }, data: { note: "değişti" } })).rejects.toThrow(/permission denied/);
      await expect(prisma.platform.subscriptionGrant.delete({ where: { id: r.body.grant.id } })).rejects.toThrow(/permission denied/);
    });

    it("geçersiz istekler reddedilir: açıklama, istek kimliği, ücretsiz/ücretli tutar kuralı", async () => {
      await create(A.tenant.id, { note: "" }).expect(400);
      await create(A.tenant.id, { requestId: "abc" }).expect(400);
      await create(A.tenant.id, { complimentary: true, agreedAmount: 500 }).expect(400);
      await create(A.tenant.id, { complimentary: false }).expect(400);
      await create(A.tenant.id, { durationDays: 0 }).expect(400);
      await create(rid()).expect(404);
      expect(await su.subscription.count({ where: { tenantId: A.tenant.id } })).toBe(0);
    });

    it("işletme PATCH ile doğrudan ACTIVE yapılamaz (aktiflik yalnızca abonelikle)", async () => {
      await admin.patch(`/platform/tenants/${A.tenant.id}`).send({ status: "ACTIVE" }).expect(400);
    });
  });

  describe("oluşturma ve gerçek tahsilattan ayrım", () => {
    it("ücretsiz manuel abonelik: işletme aktif, ödeme kaydı yok, defter ve denetim kaydı var", async () => {
      const r = await create(A.tenant.id, { planCode: "SMART", billingCycle: "YEARLY" }).expect(200);
      expect(r.body.replayed).toBe(false);
      expect(r.body.subscription).toMatchObject({ source: "MANUAL", provider: "manual", isComplimentary: true, status: "ACTIVE", planCode: "SMART" });
      const t = await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } });
      expect(t).toMatchObject({ status: "ACTIVE", planCode: "SMART" });
      expect(await su.subscriptionPayment.count({ where: { tenantId: A.tenant.id } })).toBe(0);
      const grants = await su.subscriptionGrant.findMany({ where: { tenantId: A.tenant.id } });
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({ action: "CREATED", isComplimentary: true, note: "Açılış hediyesi" });
      expect(grants[0].agreedAmount.toFixed(2)).toBe("0.00");
      expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: "platform.subscription_manual_created" } })).toBe(1);
      const end = new Date(r.body.subscription.currentPeriodEnd).getTime();
      expect(end - Date.now()).toBeGreaterThan(364 * DAY);
      // İşletme kendi abonelik sayfasında manuel aboneliği görür, ödeme listesi boştur.
      const mine = await a.get("/subscription").expect(200);
      expect(mine.body.subscription).toMatchObject({ source: "MANUAL", isComplimentary: true });
      expect(mine.body.payments).toEqual([]);
    });

    it("işletme manuel aboneliği kendisi iptal edemez", async () => {
      const r = await a.post("/subscription/cancel").expect(409);
      expect(r.body.message).toMatch(/yönetici tarafından/);
      expect((await su.subscription.findFirstOrThrow({ where: { tenantId: A.tenant.id, source: "MANUAL" } })).cancelAtPeriodEnd).toBe(false);
    });

    it("manuel aboneliğe veritabanında bile ödeme kaydı bağlanamaz; kaynak değiştirilemez", async () => {
      const sub = await su.subscription.findFirstOrThrow({ where: { tenantId: A.tenant.id, source: "MANUAL" } });
      await expect(
        prisma.platform.subscriptionPayment.create({ data: { tenantId: A.tenant.id, subscriptionId: sub.id, amount: 100, status: "PAID", provider: "mock" } }),
      ).rejects.toThrow(/Manuel aboneliğe ödeme kaydı eklenemez/);
      await expect(prisma.platform.subscription.update({ where: { id: sub.id }, data: { source: "PROVIDER", provider: "mock" } })).rejects.toThrow(/değiştirilemez|check/i);
    });

    it("açık abonelik varken ikinci manuel abonelik açılamaz", async () => {
      const r = await create(A.tenant.id).expect(409);
      expect(r.body.message).toMatch(/uzatma veya yenileme/);
    });

    it("açık abonelikte işletme paketi PATCH ile değiştirilemez (abonelikle ayrışmaz)", async () => {
      const r = await admin.patch(`/platform/tenants/${A.tenant.id}`).send({ planCode: "STARTER" }).expect(409);
      expect(r.body.message).toMatch(/abonelik bölümünden/);
      expect((await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } })).planCode).toBe("SMART");
    });

    it("ücretli manuel abonelikte anlaşılan tutar defterde tutulur ama MRR'a girmez", async () => {
      const T = await newTenant("Havaleli");
      const before = (await admin.get("/platform/stats").expect(200)).body;
      const r = await create(T.tenant.id, { complimentary: false, agreedAmount: 1500, note: "Havale ile ödendi" }).expect(200);
      expect(r.body.grant.agreedAmount).toBe("1500");
      expect(r.body.subscription.isComplimentary).toBe(false);
      const after = (await admin.get("/platform/stats").expect(200)).body;
      expect(after.mrr).toBe(before.mrr);
      expect(after.activeSubscriptions).toBe(before.activeSubscriptions);
      expect(after.manualSubscriptions.total).toBe(before.manualSubscriptions.total + 1);
      expect(await su.subscriptionPayment.count({ where: { tenantId: T.tenant.id } })).toBe(0);
    });

    it("pasif işletmede manuel abonelik durumu açmaz; açılınca ACTIVE'e döner", async () => {
      const T = await newTenant("Pasif Salon");
      await admin.post(`/platform/tenants/${T.tenant.id}/suspend`).send({ reason: "İnceleme" }).expect(200);
      await create(T.tenant.id).expect(200);
      expect(await su.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).toMatchObject({ status: "SUSPENDED", suspendedFromStatus: "ACTIVE" });
      await admin.post(`/platform/tenants/${T.tenant.id}/reactivate`).expect(200);
      expect((await su.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).status).toBe("ACTIVE");
    });

    it("işletme detayında abonelik defteri listelenir", async () => {
      const r = await admin.get(`/platform/tenants/${A.tenant.id}`).expect(200);
      expect(r.body.subscriptions[0].grants).toHaveLength(1);
      expect(r.body.subscriptions[0].payments).toEqual([]);
    });
  });

  describe("tekrar ve eşzamanlı istekler", () => {
    it("aynı istek kimliğiyle tekrar: işlem bir kez uygulanır, önceki sonuç döner", async () => {
      const T = await newTenant("Tekrar");
      const requestId = rid();
      const r1 = await create(T.tenant.id, { requestId }).expect(200);
      const r2 = await create(T.tenant.id, { requestId }).expect(200);
      expect(r2.body.replayed).toBe(true);
      expect(r2.body.subscription.id).toBe(r1.body.subscription.id);
      expect(await su.subscription.count({ where: { tenantId: T.tenant.id } })).toBe(1);
      expect(await su.subscriptionGrant.count({ where: { tenantId: T.tenant.id } })).toBe(1);
      expect(await su.auditLog.count({ where: { tenantId: T.tenant.id, action: "platform.subscription_manual_created" } })).toBe(1);
    });

    it("eşzamanlı aynı istek: tek abonelik", async () => {
      const T = await newTenant("Cift Tik");
      const requestId = rid();
      const rs = await Promise.all(Array.from({ length: 5 }, () => create(T.tenant.id, { requestId })));
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(new Set(rs.map((r) => r.body.subscription.id)).size).toBe(1);
      expect(rs.filter((r) => !r.body.replayed)).toHaveLength(1);
      expect(await su.subscription.count({ where: { tenantId: T.tenant.id } })).toBe(1);
    });

    it("eşzamanlı farklı istekler: yalnızca biri abonelik açar, diğerleri 409", async () => {
      const T = await newTenant("Yaris");
      const rs = await Promise.all(Array.from({ length: 5 }, () => create(T.tenant.id)));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await su.subscription.count({ where: { tenantId: T.tenant.id } })).toBe(1);
      expect(await su.subscriptionGrant.count({ where: { tenantId: T.tenant.id } })).toBe(1);
    });

    it("istek kimliği başka bir işlem/işletme için tekrar kullanılamaz", async () => {
      const T = await newTenant("Kimlik");
      const requestId = rid();
      const r = await create(T.tenant.id, { requestId }).expect(200);
      await admin.post(`/platform/subscriptions/${r.body.subscription.id}/extend`).send({ days: 5, note: "uzatma", requestId }).expect(409);
      const U = await newTenant("Kimlik Iki");
      await create(U.tenant.id, { requestId }).expect(409);
      expect(await su.subscription.count({ where: { tenantId: U.tenant.id } })).toBe(0);
    });
  });

  describe("uzatma, yenileme, paket atama, iptal", () => {
    let T: Awaited<ReturnType<typeof newTenant>>;
    let subId: string;
    let end: number;
    beforeAll(async () => {
      T = await newTenant("Yonetilen");
      const r = await create(T.tenant.id, { durationDays: 30 }).expect(200);
      subId = r.body.subscription.id;
      end = new Date(r.body.subscription.currentPeriodEnd).getTime();
    });
    const sub = () => su.subscription.findUniqueOrThrow({ where: { id: subId } });

    it("süre uzatma gün ekler; tekrar istek ikinci kez uzatmaz; eşzamanlı farklı uzatmalar toplanır", async () => {
      const requestId = rid();
      await admin.post(`/platform/subscriptions/${subId}/extend`).send({ days: 10, note: "Telafi", requestId }).expect(200);
      await admin.post(`/platform/subscriptions/${subId}/extend`).send({ days: 10, note: "Telafi", requestId }).expect(200);
      expect((await sub()).currentPeriodEnd.getTime()).toBe(end + 10 * DAY);
      await Promise.all([5, 5, 5].map((days) => admin.post(`/platform/subscriptions/${subId}/extend`).send({ days, note: "Toplu", requestId: rid() }).expect(200)));
      expect((await sub()).currentPeriodEnd.getTime()).toBe(end + 25 * DAY);
      expect(await su.subscriptionGrant.count({ where: { subscriptionId: subId, action: "EXTENDED" } })).toBe(4);
      expect(await su.auditLog.count({ where: { tenantId: T.tenant.id, action: "platform.subscription_manual_extended" } })).toBe(4);
      await admin.post(`/platform/subscriptions/${subId}/extend`).send({ days: 400, note: "çok", requestId: rid() }).expect(400);
    });

    it("paket atama: abonelik ve işletme paketi değişir; personel sınırı aşılıyorsa reddedilir", async () => {
      await admin.post(`/platform/subscriptions/${subId}/plan`).send({ planCode: "SMART", note: "Yükseltme", requestId: rid() }).expect(200);
      expect((await sub()).planCode).toBe("SMART");
      expect((await su.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).planCode).toBe("SMART");
      await admin.post(`/platform/subscriptions/${subId}/plan`).send({ planCode: "SMART", note: "Aynı", requestId: rid() }).expect(409);
      for (let i = 0; i < 4; i++) await su.staffMember.create({ data: { tenantId: T.tenant.id, displayName: `P${i}` } });
      const r = await admin.post(`/platform/subscriptions/${subId}/plan`).send({ planCode: "STARTER", note: "Düşürme", requestId: rid() }).expect(409);
      expect(r.body.message).toMatch(/4 aktif personel/);
      expect((await sub()).planCode).toBe("SMART");
    });

    it("yenileme: yeni dönem mevcut bitişten başlar, tutar defterde; dönem sonu iptalini kaldırır", async () => {
      const before = await sub();
      const r = await admin.post(`/platform/subscriptions/${subId}/renew`).send({ complimentary: false, agreedAmount: 999, note: "Yıllık sözleşme", requestId: rid() }).expect(200);
      expect(new Date(r.body.subscription.currentPeriodStart).getTime()).toBe(before.currentPeriodEnd.getTime());
      expect(r.body.grant).toMatchObject({ action: "RENEWED", agreedAmount: "999", isComplimentary: false });
      expect(await su.subscriptionPayment.count({ where: { tenantId: T.tenant.id } })).toBe(0);
    });

    it("iptal: dönem sonunda işaretlenir, sonra hemen iptal işletmeyi kapatır; iptal edilmiş abonelik değiştirilemez", async () => {
      await admin.post(`/platform/subscriptions/${subId}/cancel`).send({ mode: "period_end", note: "Müşteri istedi", requestId: rid() }).expect(200);
      expect((await sub()).cancelAtPeriodEnd).toBe(true);
      await admin.post(`/platform/subscriptions/${subId}/cancel`).send({ mode: "period_end", note: "Tekrar", requestId: rid() }).expect(409);
      await admin.post(`/platform/subscriptions/${subId}/cancel`).send({ mode: "immediate", note: "Sözleşme bitti", requestId: rid() }).expect(200);
      expect((await sub()).status).toBe("CANCELLED");
      expect((await su.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).status).toBe("CANCELLED");
      await admin.post(`/platform/subscriptions/${subId}/extend`).send({ days: 5, note: "geç", requestId: rid() }).expect(409);
      await admin.post(`/platform/subscriptions/${subId}/renew`).send({ complimentary: true, note: "geç", requestId: rid() }).expect(409);
      expect(await su.auditLog.count({ where: { tenantId: T.tenant.id, action: "platform.subscription_cancelled" } })).toBe(2);
      // İptalden sonra yeni manuel abonelik açılabilir.
      await create(T.tenant.id, { planCode: "SMART" }).expect(200);
      expect((await su.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).status).toBe("ACTIVE");
    });

    it("ödeme sağlayıcılı abonelik elle uzatılamaz/yenilenemez/paket değiştirilemez, yalnızca iptal edilir", async () => {
      const P = await newTenant("Kartli", "ACTIVE");
      const p = await su.subscription.create({
        data: { tenantId: P.tenant.id, planCode: "PROFESSIONAL", billingCycle: "MONTHLY", currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * DAY), provider: "mock" },
      });
      await admin.post(`/platform/subscriptions/${p.id}/extend`).send({ days: 5, note: "x x", requestId: rid() }).expect(409);
      await admin.post(`/platform/subscriptions/${p.id}/renew`).send({ complimentary: true, note: "x x", requestId: rid() }).expect(409);
      await admin.post(`/platform/subscriptions/${p.id}/plan`).send({ planCode: "SMART", note: "x x", requestId: rid() }).expect(409);
      const c = await create(P.tenant.id).expect(409);
      expect(c.body.message).toMatch(/önce onu iptal edin/);
      await admin.post(`/platform/subscriptions/${p.id}/cancel`).send({ mode: "period_end", note: "Sahip istedi", requestId: rid() }).expect(200);
      expect((await su.subscription.findUniqueOrThrow({ where: { id: p.id } })).cancelAtPeriodEnd).toBe(true);
    });
  });

  it("günlük görev: süresi dolan manuel abonelik tahsilat denenmeden PAST_DUE olur, ödeme kaydı oluşmaz", async () => {
    const T = await newTenant("Suresi Dolan");
    const r = await create(T.tenant.id, { durationDays: 1 }).expect(200);
    const pay = app.get(PaymentProvider) as MockPaymentProvider;
    const charges = pay.charges.length;
    const at = new Date(Date.now() + 3 * DAY);
    const res = await app.get(JobsService).runDaily({ now: at, force: true });
    expect((res as any).result.manualExpired).toBeGreaterThanOrEqual(1);
    expect((await su.subscription.findUniqueOrThrow({ where: { id: r.body.subscription.id } })).status).toBe("PAST_DUE");
    expect((await su.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).status).toBe("PAST_DUE");
    expect(await su.subscriptionPayment.count({ where: { tenantId: T.tenant.id } })).toBe(0);
    expect(pay.charges.length).toBe(charges);
    // Tekrar çalıştırma ikinci kez işlem yapmaz.
    await app.get(JobsService).runDaily({ now: at, force: true });
    expect(await su.auditLog.count({ where: { tenantId: T.tenant.id, action: "lifecycle.manual_expired" } })).toBe(1);
    // Owner yenileyince yeniden aktif olur.
    await admin.post(`/platform/subscriptions/${r.body.subscription.id}/renew`).send({ complimentary: true, note: "Yenilendi", requestId: rid() }).expect(200);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: T.tenant.id } })).status).toBe("ACTIVE");
  });
});
