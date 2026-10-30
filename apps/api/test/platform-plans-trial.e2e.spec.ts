import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { api, createApp, createTenantWithUser, enableMfa, login, owner, resetDb, TEST_PASSWORD } from "./helpers";

const DAY = 86_400_000;

describe("SaaS sahibi: paketler, deneme süresi ve abonelik izleme", () => {
  const su = owner();
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local", status: "TRIAL" });
    await su.user.create({ data: { email: "admin@proguzellik.test", fullName: "Sahip", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true } });
    app = await createApp();
    admin = api(app, (await enableMfa(app, "admin@proguzellik.test")).token);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  const plan = { code: "kurumsal_plus", name: "Kurumsal Plus", maxStaff: 40, monthlyPrice: 2500, yearlyPrice: 25000, features: ["CRM", "APPOINTMENTS", "REPORTS", "REPORTS"] };

  describe("paket yönetimi", () => {
    it("işletme sahibi paket oluşturamaz/düzenleyemez", async () => {
      const a = api(app, await login(app, "a@test.local"), A.tenant.id);
      await a.post("/platform/plans").send(plan).expect(403);
      await a.patch("/platform/plans/STARTER").send({ monthlyPrice: 1 }).expect(403);
    });

    it("yeni paket oluşturulur; kod büyük harfe çevrilir, özellikler tekilleşir, denetim kaydı yazılır", async () => {
      const r = await admin.post("/platform/plans").send(plan).expect(201);
      expect(r.body).toMatchObject({ code: "KURUMSAL_PLUS", maxStaff: 40, monthlyPrice: "2500", isActive: true });
      // Tekilleşir; temel özellikler (müşteri, randevu, kasa, paket) her pakette eklenir
      expect(r.body.features).toEqual(["CRM", "APPOINTMENTS", "FINANCE", "PACKAGES", "REPORTS"]);
      await admin.post("/platform/plans").send(plan).expect(409);
      expect(await su.auditLog.count({ where: { action: "platform.plan_created" } })).toBe(1);
    });

    it("geçersiz girdiler reddedilir", async () => {
      await admin.post("/platform/plans").send({ ...plan, code: "1x" }).expect(400);
      await admin.post("/platform/plans").send({ ...plan, code: "YENI", features: ["UCURAN_HALI"] }).expect(400);
      await admin.post("/platform/plans").send({ ...plan, code: "YENI", monthlyPrice: -1 }).expect(400);
      await admin.post("/platform/plans").send({ ...plan, code: "YENI", monthlyPrice: 10.001 }).expect(400);
      await admin.post("/platform/plans").send({ ...plan, code: "YENI", monthlyPrice: 100, yearlyPrice: 5000 }).expect(409);
      await admin.patch("/platform/plans/YOK_BOYLE").send({ name: "X paket" }).expect(404);
    });

    it("fiyat, limit ve özellikler düzenlenir; önceki/sonraki değer kaydedilir", async () => {
      const r = await admin.patch("/platform/plans/KURUMSAL_PLUS").send({ monthlyPrice: 2750.5, features: ["CRM", "STOCK"], sortOrder: 9 }).expect(200);
      expect(r.body).toMatchObject({ monthlyPrice: "2750.5", features: ["CRM", "APPOINTMENTS", "FINANCE", "PACKAGES", "STOCK"], sortOrder: 9 });
      const log = await su.auditLog.findFirstOrThrow({ where: { action: "platform.plan_updated" }, orderBy: { createdAt: "desc" } });
      expect(log.metadata).toMatchObject({ code: "KURUMSAL_PLUS", changes: { monthlyPrice: { to: 2750.5 } } });
    });

    it("yeni paketle işletme açılır; pasif pakete işletme atanamaz", async () => {
      const r = await admin.post("/platform/tenants").send({ name: "Kurumsal Salon", ownerName: "Ayşe Kaya", ownerEmail: "kurumsal@ornek.test", planCode: "KURUMSAL_PLUS" }).expect(201);
      const t = await su.tenant.findUniqueOrThrow({ where: { id: r.body.tenant?.id ?? r.body.id } });
      expect(t.planCode).toBe("KURUMSAL_PLUS");
      await admin.patch("/platform/plans/KURUMSAL_PLUS").send({ isActive: false }).expect(200);
      await admin.post("/platform/tenants").send({ name: "Başka Salon", ownerName: "Ali Can", ownerEmail: "baska@ornek.test", planCode: "KURUMSAL_PLUS" }).expect(409);
      await admin.post("/platform/tenants").send({ name: "Başka Salon", ownerName: "Ali Can", ownerEmail: "baska@ornek.test", planCode: "OLMAYAN" }).expect(404);
      await admin.patch("/platform/plans/KURUMSAL_PLUS").send({ isActive: true }).expect(200);
    });

    it("personel sınırı, mevcut kullanımın altına düşürülemez", async () => {
      await su.staffMember.createMany({ data: [1, 2, 3].map((i) => ({ tenantId: A.tenant.id, displayName: `P${i}` })) });
      await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "KURUMSAL_PLUS" } });
      const r = await admin.patch("/platform/plans/KURUMSAL_PLUS").send({ maxStaff: 2 }).expect(409);
      expect(r.body.message).toMatch(/Salon A \(3\)/);
      await admin.patch("/platform/plans/KURUMSAL_PLUS").send({ maxStaff: 3 }).expect(200);
      await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "PROFESSIONAL" } });
    });

    it("veritabanı bütünlüğü: kod biçimi kontrolü ve kullanımdaki paket silinemez", async () => {
      await expect(su.plan.create({ data: { code: "kucuk", name: "x", maxStaff: 1, monthlyPrice: 0, yearlyPrice: 0, features: [] } })).rejects.toThrow();
      await expect(su.plan.delete({ where: { code: "KURUMSAL_PLUS" } })).rejects.toThrow();
      await expect(su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "YOK" } })).rejects.toThrow();
      const enumLeft = await su.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_type WHERE typname = 'PlanCode'`;
      expect(Number(enumLeft[0].n)).toBe(0);
    });
  });

  describe("deneme süresi", () => {
    it("gerekçe zorunlu; gün ya da tarihten yalnız biri", async () => {
      await admin.post(`/platform/tenants/${A.tenant.id}/trial`).send({ days: 7 }).expect(400);
      await admin.post(`/platform/tenants/${A.tenant.id}/trial`).send({ days: 7, until: new Date(Date.now() + 9 * DAY).toISOString(), reason: "Fuar" }).expect(400);
      await admin.post(`/platform/tenants/${A.tenant.id}/trial`).send({ days: 500, reason: "Fuar" }).expect(400);
    });

    it("deneme sürecindeki işletmede bitiş ileri alınır ve kaydedilir", async () => {
      const before = (await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } })).trialEndsAt!;
      const r = await admin.post(`/platform/tenants/${A.tenant.id}/trial`).send({ days: 7, reason: "Kurulum desteği" }).expect(200);
      expect(new Date(r.body.trialEndsAt).getTime()).toBe(before.getTime() + 7 * DAY);
      const log = await su.auditLog.findFirstOrThrow({ where: { action: "platform.trial_extended", tenantId: A.tenant.id } });
      expect(log.metadata).toMatchObject({ from: before.toISOString(), reason: "Kurulum desteği", previousStatus: "TRIAL" });
    });

    it("süresi dolmuş deneme yeniden açılır, veriler korunur", async () => {
      await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Kalıcı", lastName: "Müşteri" } });
      await su.tenant.update({ where: { id: A.tenant.id }, data: { status: "PAST_DUE", trialEndsAt: new Date(Date.now() - DAY), pastDueSince: new Date(Date.now() - DAY) } });
      const until = new Date(Date.now() + 10 * DAY).toISOString();
      await admin.post(`/platform/tenants/${A.tenant.id}/trial`).send({ until, reason: "Görüşme" }).expect(200);
      const t = await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id } });
      expect(t).toMatchObject({ status: "TRIAL", pastDueSince: null });
      expect(t.trialEndsAt!.toISOString()).toBe(until);
      expect(await su.customer.count({ where: { tenantId: A.tenant.id } })).toBe(1);
      await admin.post(`/platform/tenants/${A.tenant.id}/trial`).send({ until: new Date(Date.now() - DAY).toISOString(), reason: "Görüşme" }).expect(409);
    });

    it("aboneliği olan ya da askıdaki işletmede reddedilir; işletme sahibi kullanamaz", async () => {
      const a = api(app, await login(app, "a@test.local"), A.tenant.id);
      await a.post(`/platform/tenants/${A.tenant.id}/trial`).send({ days: 7, reason: "Kendim" }).expect(403);
      await admin.post(`/platform/tenants/${A.tenant.id}/subscriptions`).send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", complimentary: true, note: "Açılış hediyesi", requestId: randomUUID() }).expect(200);
      await admin.post(`/platform/tenants/${A.tenant.id}/trial`).send({ days: 7, reason: "Deneme" }).expect(409);
      const S = await createTenantWithUser(su, { name: "Askıda Salon", email: "askida@test.local", status: "TRIAL" });
      await admin.post(`/platform/tenants/${S.tenant.id}/suspend`).send({ reason: "Ödeme yok" }).expect(200);
      await admin.post(`/platform/tenants/${S.tenant.id}/trial`).send({ days: 7, reason: "Deneme" }).expect(409);
    });
  });

  describe("abonelik izleme", () => {
    it("özet ve filtreler", async () => {
      const r = await admin.get("/platform/subscriptions").expect(200);
      expect(r.body.summary.tenants).toMatchObject({ ACTIVE: 1, SUSPENDED: 1 });
      expect(r.body.summary.subscriptions).toMatchObject({ ACTIVE: 1 });
      expect(r.body.items[0]).toMatchObject({ source: "MANUAL", isComplimentary: true, tenant: { name: "Salon A" }, plan: { code: "PROFESSIONAL" } });
      expect((await admin.get("/platform/subscriptions?source=PROVIDER").expect(200)).body.items).toHaveLength(0);
      expect((await admin.get("/platform/subscriptions?expiringDays=40").expect(200)).body.items).toHaveLength(1);
      expect((await admin.get("/platform/subscriptions?q=yok").expect(200)).body.items).toHaveLength(0);
      const a = api(app, await login(app, "a@test.local"), A.tenant.id);
      await a.get("/platform/subscriptions").expect(403);
    });
  });
});
