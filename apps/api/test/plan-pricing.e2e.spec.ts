import { INestApplication } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { PaymentProvider } from "../src/billing/payment-provider";
import { priceForNewSale, priceForRenewal, PriceVersion, withVat } from "../src/billing/plan-pricing";
import { SubscriptionsService } from "../src/billing/subscriptions.service";
import { loadEnv } from "../src/config/env";
import { addMember, api, createApp, createTenantWithUser, enableMfa, freshTotp, futureAt, login, owner, resetDb, setupSalon, TEST_PASSWORD } from "./helpers";

const DAY = 86_400_000;
const D = (n: number) => new Prisma.Decimal(n);

describe("Fiyat kuralları (birim)", () => {
  const v = (version: number, o: Partial<PriceVersion> = {}): PriceVersion => ({
    id: `v${version}`, version, status: "APPROVED", monthlyPrice: D(version * 100), yearlyPrice: D(version * 1000), vatRate: D(20),
    effectiveFrom: new Date("2030-01-01"), renewalPolicy: "KEEP_EXISTING", renewalsFrom: null, ...o,
  });

  it("yeni satışta yürürlükteki en son onaylı sürüm; taslak/iptal ve ileri tarihli sürüm kullanılmaz", () => {
    const list = [v(1), v(2, { effectiveFrom: new Date("2030-06-01") }), { ...v(3), status: "DRAFT" as const, version: null }, { ...v(4), status: "CANCELLED" as const }];
    expect(priceForNewSale(list, new Date("2029-12-31"))).toBeNull();
    expect(priceForNewSale(list, new Date("2030-03-01"))?.id).toBe("v1");
    expect(priceForNewSale(list, new Date("2030-06-01"))?.id).toBe("v2");
  });

  it("yenileme: kilitli fiyat korunur; yalnız 'yenilemede uygula' sürümü, tarihinden sonra başlayan dönemde geçerli olur", () => {
    const keep = v(2, { effectiveFrom: new Date("2030-02-01") });
    const apply = v(3, { effectiveFrom: new Date("2030-03-01"), renewalPolicy: "APPLY_ON_RENEWAL", renewalsFrom: new Date("2030-05-01") });
    const locked = v(1);
    expect(priceForRenewal([locked, keep], locked, new Date("2030-04-01"))?.id).toBe("v1");
    expect(priceForRenewal([locked, keep, apply], locked, new Date("2030-04-30"))?.id).toBe("v1");
    expect(priceForRenewal([locked, keep, apply], locked, new Date("2030-05-01"))?.id).toBe("v3");
    // Daha yeni bir sürüme zaten kilitliyse eski "uygula" sürümüne geri dönülmez
    expect(priceForRenewal([locked, apply, v(4, { effectiveFrom: new Date("2030-06-01") })], v(4), new Date("2030-07-01"))?.id).toBe("v4");
    // Kilidi olmayan eski abonelik: dönemin başındaki yeni satış fiyatı
    expect(priceForRenewal([locked, keep], null, new Date("2030-02-15"))?.id).toBe("v2");
  });

  it("KDV kuruşa yuvarlanır", () => {
    expect(withVat(D(333.33), D(18))).toEqual({ net: D(333.33), vat: D(60), gross: D(393.33) });
    expect(withVat(D(1000), D(20)).gross.toFixed(2)).toBe("1200.00");
    expect(withVat(D(999.99), D(0)).gross.toFixed(2)).toBe("999.99");
  });
});

describe("SaaS sahibi paket fiyat yönetimi", () => {
  const su = owner();
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let mfaSecret: string;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let subs: SubscriptionsService;
  const http = () => request(app.getHttpServer());
  const ADMIN = "fiyat-admin@proguzellik.test";
  const approve = async (code: string, id: string) =>
    admin.post(`/platform/plans/${code}/prices/${id}/approve`).send({ password: TEST_PASSWORD, code: await freshTotp(ADMIN, mfaSecret) });

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Fiyat A", email: "fa@test.local", status: "TRIAL" });
    B = await createTenantWithUser(su, { name: "Fiyat B", email: "fb@test.local", status: "TRIAL" });
    await su.user.create({ data: { email: ADMIN, fullName: "Sahip", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true } });
    app = await createApp();
    subs = app.get(SubscriptionsService);
    const m = await enableMfa(app, ADMIN);
    admin = api(app, m.token);
    mfaSecret = m.secret;
    a = api(app, await login(app, "fa@test.local"), A.tenant.id);
    b = api(app, await login(app, "fb@test.local"), B.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  describe("yetki", () => {
    it("oturumsuz 401; işletme sahibi, yönetici ve resepsiyon fiyat uç noktalarına erişemez (403)", async () => {
      await http().get("/platform/plans").expect(401);
      await http().post("/platform/plans/STARTER/prices").send({}).expect(401);
      await addMember(app, a, { email: "fa-resepsiyon@test.local", fullName: "Resepsiyon Kişi", role: "RECEPTION" });
      await addMember(app, a, { email: "fa-yonetici@test.local", fullName: "Yönetici Kişi", role: "MANAGER" });
      const users = [a, api(app, await login(app, "fa-resepsiyon@test.local"), A.tenant.id), api(app, await login(app, "fa-yonetici@test.local"), A.tenant.id)];
      const draft = await su.planPrice.create({ data: { planCode: "STARTER", monthlyPrice: 1, yearlyPrice: 0, vatRate: 20, effectiveFrom: new Date(), renewalPolicy: "KEEP_EXISTING" } });
      for (const u of users) {
        await u.get("/platform/plans").expect(403);
        await u.get("/platform/plans/STARTER/prices").expect(403);
        await u.post("/platform/plans/STARTER/prices").send({ monthlyPrice: 1, yearlyPrice: 0, vatRate: 20, renewalPolicy: "KEEP_EXISTING" }).expect(403);
        await u.post(`/platform/plans/STARTER/prices/${draft.id}/approve`).send({ password: TEST_PASSWORD, code: "123456" }).expect(403);
        await u.post(`/platform/plans/STARTER/prices/${draft.id}/cancel`).send({ reason: "deneme" }).expect(403);
        await u.patch("/platform/plans/STARTER").send({ isPublic: false }).expect(403);
      }
      expect((await su.planPrice.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
      await admin.post(`/platform/plans/STARTER/prices/${draft.id}/cancel`).send({ reason: "Test taslağı" }).expect(200);
    });

    it("işletme veritabanı rolü fiyat sürümlerini okuyamaz/yazamaz", async () => {
      const { PrismaClient } = await import("@prisma/client");
      const appDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
      await expect(appDb.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${A.tenant.id}, true)`;
        return tx.$queryRaw`SELECT * FROM "PlanPrice"`;
      })).rejects.toThrow(/permission denied/i);
      await appDb.$disconnect();
    });
  });

  describe("onay ve tanıtım sitesi", () => {
    let draftId: string;

    it("onaylı fiyatı olmayan paket sitede ve işletme panelinde tutarsız görünür; eski (demo) tutarlar hiçbir yanıtta yoktur", async () => {
      const r = await http().get("/plans").expect(200);
      expect(r.body.map((p: any) => p.code)).toEqual(["STARTER", "PROFESSIONAL", "SMART"]);
      for (const p of r.body) expect(p).toMatchObject({ monthlyPrice: null, yearlyPrice: null, vatRate: null });
      expect(JSON.stringify(r.body)).not.toMatch(/499|999|1799/);
      const site = await http().get("/public/site").expect(200);
      expect(site.body.pricesAnnounced).toBe(false);
      const cur = await a.get("/subscription").expect(200);
      expect(cur.body.plan).toMatchObject({ code: "PROFESSIONAL", monthlyPrice: null });
      expect(JSON.stringify(cur.body.plan)).not.toMatch(/499|999|1799/);
      // Satın alma yapılamaz
      const c = await a.post("/subscription/checkout").send({ planCode: "STARTER", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(409);
      expect(c.body.code).toBe("PRICE_NOT_APPROVED");
      expect(await su.subscription.count()).toBe(0);
    });

    it("taslak fiyat sitede görünmez", async () => {
      const r = await admin.post("/platform/plans/STARTER/prices").send({ monthlyPrice: 1000, yearlyPrice: 10000, vatRate: 20, renewalPolicy: "KEEP_EXISTING", note: "Açılış fiyatı" }).expect(201);
      expect(r.body).toMatchObject({ status: "DRAFT", version: null, monthlyPrice: "1000.00", vatRate: "20.00", createdBy: ADMIN });
      draftId = r.body.id;
      const p = (await http().get("/plans").expect(200)).body.find((x: any) => x.code === "STARTER");
      expect(p.monthlyPrice).toBeNull();
      const list = (await admin.get("/platform/plans").expect(200)).body.find((x: any) => x.code === "STARTER");
      expect(list).toMatchObject({ currentPrice: null, draftCount: 1 });
      expect(list.monthlyPrice).toBeUndefined();
    });

    it("onay parola + güncel 2FA kodu ister; hatalıysa hiçbir şey değişmez", async () => {
      await admin.post(`/platform/plans/STARTER/prices/${draftId}/approve`).send({ password: TEST_PASSWORD }).expect(400);
      await admin.post(`/platform/plans/STARTER/prices/${draftId}/approve`).send({ password: "YanlisParola1", code: await freshTotp(ADMIN, mfaSecret) }).expect(401);
      await admin.post(`/platform/plans/STARTER/prices/${draftId}/approve`).send({ password: TEST_PASSWORD, code: "000000" }).expect(401);
      expect((await su.planPrice.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("DRAFT");
      expect(await su.auditLog.count({ where: { action: "auth.reauth_failed" } })).toBeGreaterThanOrEqual(2);
    });

    it("onaylanan fiyat sitede KDV hariç ve KDV oranıyla görünür; denetim kaydı yazılır", async () => {
      const r = await approve("STARTER", draftId);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: "APPROVED", version: 1, approvedBy: ADMIN });
      const p = (await http().get("/plans").expect(200)).body.find((x: any) => x.code === "STARTER");
      expect(p).toMatchObject({ monthlyPrice: "1000.00", yearlyPrice: "10000.00", vatRate: "20.00", pricesIncludeVat: false });
      // Diğer paketler hâlâ fiyatsız
      expect((await http().get("/plans")).body.find((x: any) => x.code === "SMART").monthlyPrice).toBeNull();
      expect((await http().get("/public/site")).body.pricesAnnounced).toBe(true);
      const log = await su.auditLog.findFirstOrThrow({ where: { action: "platform.plan_price_approved" } });
      expect(log.metadata).toMatchObject({ plan: "STARTER", version: 1, monthly: "1000.00", vatRate: "20.00" });
      // Taslak tekrar onaylanamaz
      await approve("STARTER", draftId).then((x) => expect(x.status).toBe(409));
    });

    it("onaylı sürüm değiştirilemez, silinemez; yürürlükteki sürüm iptal edilemez", async () => {
      await expect(su.planPrice.update({ where: { id: draftId }, data: { monthlyPrice: 1 } })).rejects.toThrow(/değiştirilemez/);
      await expect(su.planPrice.delete({ where: { id: draftId } })).rejects.toThrow(/silinemez/);
      await admin.post(`/platform/plans/STARTER/prices/${draftId}/cancel`).send({ reason: "Vazgeçtim" }).expect(409);
    });

    it("geçmiş tarihli taslak geriye dönük uygulanmaz: yürürlük onay anına çekilir", async () => {
      const past = new Date(Date.now() - 10 * DAY).toISOString();
      const d = await admin.post("/platform/plans/PROFESSIONAL/prices").send({ monthlyPrice: 2000, yearlyPrice: 20000, vatRate: 20, effectiveFrom: past, renewalPolicy: "APPLY_ON_RENEWAL", renewalsFrom: past }).expect(201);
      const before = Date.now();
      const r = await approve("PROFESSIONAL", d.body.id);
      expect(r.status).toBe(200);
      expect(new Date(r.body.effectiveFrom).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(new Date(r.body.renewalsFrom).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it("gizli veya pasif paket sitede listelenmez, işletme satın alamaz ve kayıtta seçilemez; SaaS sahibi atayabilir", async () => {
      await admin.patch("/platform/plans/PROFESSIONAL").send({ isPublic: false }).expect(200);
      expect((await http().get("/plans")).body.map((x: any) => x.code)).toEqual(["STARTER", "SMART"]);
      await b.post("/subscription/checkout").send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(404);
      await admin.patch("/platform/plans/SMART").send({ isActive: false }).expect(200);
      expect((await http().get("/plans")).body.map((x: any) => x.code)).toEqual(["STARTER"]);
      await admin.patch("/platform/plans/SMART").send({ isActive: true }).expect(200);
      await admin.patch("/platform/plans/PROFESSIONAL").send({ isPublic: true }).expect(200);
    });

    it("PRICING_PUBLIC=0 acil durum anahtarı tüm tutarları gizler", async () => {
      const env = loadEnv();
      const before = env.PRICING_PUBLIC;
      Object.assign(env, { PRICING_PUBLIC: "0" });
      try {
        const r = await http().get("/plans").expect(200);
        for (const p of r.body) expect(p.monthlyPrice).toBeNull();
      } finally {
        Object.assign(env, { PRICING_PUBLIC: before });
      }
    });
  });

  describe("fiyat kilidi ve yenileme (finans)", () => {
    let subA: string;

    it("satın almada fiyat kilitlenir; tahsilat KDV dahil, KDV hariç tutar ve oran kaydedilir", async () => {
      const r = await a.post("/subscription/checkout").send({ planCode: "STARTER", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(201);
      subA = r.body.id;
      const s = await su.subscription.findUniqueOrThrow({ where: { id: subA }, include: { planPrice: true, payments: true } });
      expect(s.planPrice?.version).toBe(1);
      expect(s.priceAmount?.toFixed(2)).toBe("1000.00");
      expect(s.vatRate?.toFixed(2)).toBe("20.00");
      expect(s.payments[0]).toMatchObject({ status: "PAID" });
      expect(s.payments[0].amount.toFixed(2)).toBe("1200.00");
      expect(s.payments[0].netAmount?.toFixed(2)).toBe("1000.00");
      const pay = app.get(PaymentProvider) as any;
      expect(pay.charges.at(-1)).toMatchObject({ amount: "1200.00" });
      // Bağlı sürüm artık iptal edilemez (veritabanı da reddeder)
      await expect(su.planPrice.update({ where: { id: s.planPriceId! }, data: { status: "CANCELLED", cancelledAt: new Date() } })).rejects.toThrow();
    });

    it("yeni fiyat (mevcutlar korunur): mevcut abonelik yenilemede eski fiyatla devam eder; yeni satış yeni fiyatla", async () => {
      const d = await admin.post("/platform/plans/STARTER/prices").send({ monthlyPrice: 1500, yearlyPrice: 15000, vatRate: 20, renewalPolicy: "KEEP_EXISTING" }).expect(201);
      expect((await approve("STARTER", d.body.id)).body.version).toBe(2);
      expect((await http().get("/plans")).body.find((x: any) => x.code === "STARTER").monthlyPrice).toBe("1500.00");
      // A'nın dönemi biter → yenileme eski (kilitli) fiyattan
      await su.subscription.update({ where: { id: subA }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
      const r = await subs.runLifecycle(new Date());
      expect(r.renewed).toBe(1);
      const pays = await su.subscriptionPayment.findMany({ where: { subscriptionId: subA }, orderBy: { createdAt: "asc" } });
      expect(pays.map((p) => p.amount.toFixed(2))).toEqual(["1200.00", "1200.00"]);
      expect((await su.subscription.findUniqueOrThrow({ where: { id: subA }, include: { planPrice: true } })).planPrice?.version).toBe(1);
      // B yeni satın alır → yeni fiyat
      await b.post("/subscription/checkout").send({ planCode: "STARTER", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(201);
      const sb = await su.subscription.findFirstOrThrow({ where: { tenantId: B.tenant.id, status: "ACTIVE" }, include: { planPrice: true } });
      expect(sb.planPrice?.version).toBe(2);
      expect(sb.priceAmount?.toFixed(2)).toBe("1500.00");
    });

    it("platform MRR'si kilitli fiyatlardan hesaplanır (paketin güncel fiyatından değil)", async () => {
      const s = await admin.get("/platform/stats").expect(200);
      expect(s.body.mrr).toBe("2500.00");
    });

    it("yenilemede uygula: belirlenen tarihten önce başlayan dönem eski fiyat, sonra başlayan dönem yeni fiyat", async () => {
      const renewalsFrom = new Date(Date.now() + 40 * DAY);
      const d = await admin.post("/platform/plans/STARTER/prices").send({ monthlyPrice: 1800, yearlyPrice: 18000, vatRate: 20, renewalPolicy: "APPLY_ON_RENEWAL", renewalsFrom: renewalsFrom.toISOString() }).expect(201);
      expect((await approve("STARTER", d.body.id)).body.version).toBe(3);
      // A: sıradaki dönem tarihten önce başlıyor → kilitli v1 (1000)
      const s0 = await su.subscription.findUniqueOrThrow({ where: { id: subA } });
      await subs.runLifecycle(new Date(s0.currentPeriodEnd.getTime() + 1000));
      const s1 = await su.subscription.findUniqueOrThrow({ where: { id: subA }, include: { planPrice: true } });
      expect(s1.planPrice?.version).toBe(1);
      // Sonraki dönem tarihten sonra başlıyor → v3 (1800 + %20)
      await su.subscription.update({ where: { id: subA }, data: { currentPeriodEnd: new Date(renewalsFrom.getTime() + DAY) } });
      await subs.runLifecycle(new Date(renewalsFrom.getTime() + 2 * DAY));
      const s = await su.subscription.findUniqueOrThrow({ where: { id: subA }, include: { planPrice: true, payments: { orderBy: { createdAt: "desc" }, take: 1 } } });
      expect(s.planPrice?.version).toBe(3);
      expect(s.priceAmount?.toFixed(2)).toBe("1800.00");
      expect(s.payments[0].amount.toFixed(2)).toBe("2160.00");
    });

    it("ileri tarihli onaylı fiyat tarihine kadar uygulanmaz ve yürürlüğe girmeden iptal edilebilir; fiyat geçmişi tüm sürümleri gösterir", async () => {
      const at = new Date(Date.now() + 5 * DAY).toISOString();
      const d = await admin.post("/platform/plans/SMART/prices").send({ monthlyPrice: 3000, yearlyPrice: 30000, vatRate: 20, effectiveFrom: at, renewalPolicy: "KEEP_EXISTING" }).expect(201);
      await approve("SMART", d.body.id).then((x) => expect(x.status).toBe(200));
      expect((await http().get("/plans")).body.find((x: any) => x.code === "SMART").monthlyPrice).toBeNull();
      const list = (await admin.get("/platform/plans").expect(200)).body.find((x: any) => x.code === "SMART");
      expect(list).toMatchObject({ currentPrice: null, upcomingPrice: { monthlyPrice: "3000.00" } });
      await admin.post(`/platform/plans/SMART/prices/${d.body.id}/cancel`).send({ reason: "Kampanya ertelendi" }).expect(200);
      const h = await admin.get("/platform/plans/STARTER/prices").expect(200);
      expect(h.body.items.map((x: any) => [x.version, x.status])).toEqual([[3, "APPROVED"], [2, "APPROVED"], [1, "APPROVED"], [null, "CANCELLED"]]);
      expect(h.body.items.find((x: any) => x.version === 1).lockedSubscriptions).toBe(0);
      expect(h.body.items.find((x: any) => x.version === 2).lockedSubscriptions).toBe(1);
    });
  });

  describe("kullanım sınırları", () => {
    it("müşteri sınırı panelde ve online rezervasyonda uygulanır; sınır mevcut kullanımın altına düşürülemez", async () => {
      await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "SMART", status: "ACTIVE" } });
      const s = await setupSalon(a, { duration: 30 });
      await a.post("/customers").send({ firstName: "İkinci", lastName: "Müşteri", phone: "05550000002" }).expect(201);
      const r = await admin.patch("/platform/plans/SMART").send({ maxCustomers: 1 }).expect(409);
      expect(r.body.message).toMatch(/Fiyat A \(2\)/);
      await admin.patch("/platform/plans/SMART").send({ maxCustomers: 2 }).expect(200);
      const blocked = await a.post("/customers").send({ firstName: "Üçüncü", lastName: "Müşteri", phone: "05550000003" }).expect(402);
      expect(blocked.body.message).toMatch(/en fazla 2 müşteri/);
      const pub = await http().post(`/public/salons/${A.tenant.slug}/bookings`).send({ firstName: "Online", lastName: "Kişi", phone: "05559998877", kvkkConsent: true, serviceId: s.service.id, startsAt: futureAt(3, "10:00") }).expect(409);
      expect(pub.body.message).not.toMatch(/paket|müşteri/i);
      await admin.patch("/platform/plans/SMART").send({ maxCustomers: null }).expect(200);
      await a.post("/customers").send({ firstName: "Üçüncü", lastName: "Müşteri", phone: "05550000003" }).expect(201);
    });

    it("aylık randevu sınırı uygulanır (iptal edilenler sayılmaz)", async () => {
      const [service] = (await a.get("/services").expect(200)).body;
      const staff = (await a.get("/staff").expect(200)).body;
      const customer = (await a.get("/customers").expect(200)).body.items?.[0] ?? (await a.get("/customers").expect(200)).body[0];
      await admin.patch("/platform/plans/SMART").send({ maxMonthlyAppointments: 1 }).expect(200);
      // Gelecek ayın 10'u ve 11'i (aynı takvim ayı); bir sonraki ayın 10'u başka ay
      const now = new Date();
      const days = (y: number, m: number, d: number) => Math.ceil((Date.UTC(y, m, d) - now.getTime()) / DAY);
      const d1 = days(now.getUTCFullYear(), now.getUTCMonth() + 1, 10);
      const d3 = days(now.getUTCFullYear(), now.getUTCMonth() + 2, 10);
      const book = (d: number, hhmm: string) => a.post("/appointments").send({ customerId: customer.id, staffId: staff[0].id, serviceId: service.id, startsAt: futureAt(d, hhmm) });
      const first = await book(d1, "11:00").expect(201);
      const second = await book(d1 + 1, "12:00").expect(402);
      expect(second.body.message).toMatch(/ayda en fazla 1 randevu/);
      await book(d3, "12:00").expect(201);
      // İptal edilen randevu sayılmaz
      await a.post(`/appointments/${first.body.id}/status`).send({ status: "CANCELLED", reason: "Test" }).expect(201);
      await book(d1 + 1, "12:00").expect(201);
      await admin.patch("/platform/plans/SMART").send({ maxMonthlyAppointments: null }).expect(200);
    });
  });
});
