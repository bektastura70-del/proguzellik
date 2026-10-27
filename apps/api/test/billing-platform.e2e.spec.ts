import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { api, createApp, createTenantWithUser, enableMfa, login, owner, resetDb, TEST_PASSWORD } from "./helpers";

describe("Abonelik paketleri, deneme süresi ve SaaS sahibi paneli", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;

  beforeAll(async () => {
    await resetDb(su);
    await su.plan.update({ where: { code: "STARTER" }, data: { monthlyPrice: 499 } });
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local", status: "TRIAL" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    await su.user.create({
      data: { email: "owner@proguzellik.test", fullName: "Platform Sahibi", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true },
    });
    app = await createApp();
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    b = api(app, await login(app, "b@test.local"), B.tenant.id);
    // SaaS yöneticisi için 2FA zorunlu: test hesabında açılır.
    admin = api(app, (await enableMfa(app, "owner@proguzellik.test")).token);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("paketler herkese açık: Başlangıç 3, Profesyonel 8, Akıllı 20 personel", async () => {
    const r = await request(app.getHttpServer()).get("/plans").expect(200);
    expect(r.body.map((p: any) => [p.code, p.name, p.maxStaff])).toEqual([
      ["STARTER", "Başlangıç", 3],
      ["PROFESSIONAL", "Profesyonel", 8],
      ["SMART", "Akıllı", 20],
    ]);
    expect(r.body[2].features).toContain("AI_ASSISTANT");
    expect(r.body[1].features).not.toContain("AI_ASSISTANT");
  });

  it("abonelik durumu deneme günlerini ve personel kullanımını gösterir", async () => {
    const r = await a.get("/subscription").expect(200);
    expect(r.body).toMatchObject({ status: "TRIAL", usage: { activeStaff: 0, maxStaff: 8 } });
    expect(r.body.trialDaysLeft).toBe(14);
  });

  it("Başlangıç paketinde stok/rapor modülü kapalıdır", async () => {
    await su.tenant.update({ where: { id: B.tenant.id }, data: { planCode: "STARTER" } });
    await b.get("/products").expect(403);
    await b.get(`/reports/dashboard?from=${new Date(0).toISOString()}&to=${new Date(86_400_000).toISOString()}`).expect(403);
    await b.get("/customers").expect(200);
  });

  it("personel sayısı paket sınırını aşamaz (Başlangıç: 3)", async () => {
    for (const n of ["P1", "P2", "P3"]) await b.post("/staff").send({ displayName: n }).expect(201);
    const r = await b.post("/staff").send({ displayName: "P4" }).expect(402);
    expect(r.body.message).toMatch(/en fazla 3/);
    await b.post("/staff").send({ displayName: "Pasif", isActive: false }).expect(201);
    const pasif = await su.staffMember.findFirstOrThrow({ where: { tenantId: B.tenant.id, displayName: "Pasif" } });
    await b.patch(`/staff/${pasif.id}`).send({ isActive: true }).expect(402);
  });

  it("başarısız test ödemesi aboneliği başlatmaz", async () => {
    await a.post("/subscription/checkout").send({ planCode: "SMART", billingCycle: "MONTHLY", paymentToken: "tok_fail" }).expect(402);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } })).status).toBe("TRIAL");
  });

  it("test ödemesiyle Akıllı paket aktifleşir (gerçek ödeme alınmaz)", async () => {
    const r = await a.post("/subscription/checkout").send({ planCode: "SMART", billingCycle: "YEARLY", paymentToken: "tok_test" }).expect(201);
    expect(r.body).toMatchObject({ planCode: "SMART", status: "ACTIVE", provider: "mock" });
    const cur = await a.get("/subscription").expect(200);
    expect(cur.body).toMatchObject({ status: "ACTIVE", plan: { code: "SMART" }, usage: { maxStaff: 20 } });
    expect(cur.body.payments[0]).toMatchObject({ amount: "17990", status: "PAID" });
  });

  it("aktif personel sayısı yeni paketi aşıyorsa düşürme reddedilir", async () => {
    await b.post("/subscription/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(201);
    for (const n of ["P4", "P5"]) await b.post("/staff").send({ displayName: n }).expect(201);
    const r = await b.post("/subscription/checkout").send({ planCode: "STARTER", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(409);
    expect(r.body.message).toMatch(/en fazla 3/);
  });

  it("işletme kendi durumunu/paketini veritabanından değiştiremez (sütun yetkisi)", async () => {
    const appDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
    const run = (fn: (tx: any) => Promise<unknown>) =>
      appDb.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${A.tenant.id}, true)`;
        return fn(tx);
      });
    await expect(run((tx) => tx.$executeRaw`UPDATE "Tenant" SET "planCode" = 'SMART'`)).rejects.toThrow(/permission denied/i);
    await expect(run((tx) => tx.$executeRaw`UPDATE "Tenant" SET "trialEndsAt" = now() + interval '1 year'`)).rejects.toThrow(/permission denied/i);
    await expect(run((tx) => tx.subscription.create({ data: { tenantId: A.tenant.id, planCode: "SMART", billingCycle: "MONTHLY", currentPeriodStart: new Date(), currentPeriodEnd: new Date(), provider: "x" } }))).rejects.toThrow(/permission denied/i);
    await appDb.$disconnect();
  });

  it("işletme ayarları güncellenir; durum alanı gönderilemez", async () => {
    const r = await a.patch("/settings").send({ address: "Test Mah. 1", onlineBookingEnabled: false }).expect(200);
    expect(r.body).toMatchObject({ address: "Test Mah. 1", onlineBookingEnabled: false, status: "ACTIVE" });
    const r2 = await a.patch("/settings").send({ status: "ACTIVE", planCode: "SMART" }).expect(200);
    expect(r2.body.planCode).toBe("SMART");
    expect((await su.tenant.findUniqueOrThrow({ where: { id: B.tenant.id } })).planCode).toBe("PROFESSIONAL");
  });

  it("platform paneli yalnızca platform yöneticisine açıktır", async () => {
    await a.get("/platform/stats").expect(403);
    await a.get("/platform/tenants").expect(403);
    const s = await admin.get("/platform/stats").expect(200);
    expect(s.body.tenants.total).toBe(2);
    expect(s.body.activeSubscriptions).toBe(2);
    expect(s.body.mrr).toBe((17990 / 12 + 999).toFixed(2));
  });

  it("platform tüm işletmeleri, sahiplerini ve sayıları listeler", async () => {
    const r = await admin.get("/platform/tenants").expect(200);
    expect(r.body).toHaveLength(2);
    const bRow = r.body.find((t: any) => t.id === B.tenant.id);
    expect(bRow).toMatchObject({ owner: { email: "b@test.local" }, _count: { staff: 6 } });
    const one = await admin.get(`/platform/tenants/${A.tenant.id}`).expect(200);
    expect(one.body.subscriptions[0].payments).toHaveLength(1);
  });

  it("platform işletmeyi askıya alır; işletme erişemez; tekrar açılır", async () => {
    await admin.patch(`/platform/tenants/${B.tenant.id}`).send({ status: "SUSPENDED" }).expect(200);
    await b.get("/customers").expect(403);
    await admin.patch(`/platform/tenants/${B.tenant.id}`).send({ status: "ACTIVE" }).expect(200);
    await b.get("/customers").expect(200);
    const logs = await su.auditLog.count({ where: { tenantId: B.tenant.id, action: "platform.tenant_updated" } });
    expect(logs).toBe(2);
  });

  it("deneme süresini uzatma ve paket fiyatı güncelleme", async () => {
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await admin.patch(`/platform/tenants/${A.tenant.id}`).send({ trialEndsAt: until }).expect(200);
    const p = await admin.patch("/platform/plans/STARTER").send({ monthlyPrice: 599 }).expect(200);
    expect(p.body.monthlyPrice).toBe("599");
  });

  it("dönem sonu: iptal istenen abonelik sona erer, diğeri ödemesi alınamayınca ödeme bekler", async () => {
    await a.post("/subscription/cancel").expect(200);
    await su.subscription.updateMany({ where: { status: "ACTIVE" }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    await su.savedPaymentMethod.updateMany({ where: { tenantId: B.tenant.id }, data: { token: "tok_expired" } });
    const r = await admin.post("/platform/lifecycle/run?force=true").expect(201);
    expect(r.body.result).toMatchObject({ cancelledAtPeriodEnd: 1, renewalFailed: 1 });
    expect((await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } })).status).toBe("CANCELLED");
    expect((await su.tenant.findUniqueOrThrow({ where: { id: B.tenant.id } })).status).toBe("PAST_DUE");
    await a.get("/customers").expect(402);
    await a.get("/subscription").expect(200);
    await b.get("/customers").expect(200);
    await b.post("/customers").send({ firstName: "X", lastName: "Y" }).expect(402);
    await a.post("/subscription/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(201);
    await a.post("/customers").send({ firstName: "Geri", lastName: "Döndü" }).expect(201);
  });

  it("kayıtta paket seçilebilir", async () => {
    const r = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ businessName: "Akıllı Salon", fullName: "Test", email: "akilli@test.local", password: "GucluParola2026", planCode: "SMART", kvkkAccepted: true })
      .expect(201);
    expect(r.body.user.memberships[0].tenant).toMatchObject({ planCode: "SMART", status: "TRIAL" });
  });
});
