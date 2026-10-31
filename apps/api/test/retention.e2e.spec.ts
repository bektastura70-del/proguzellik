import { INestApplication } from "@nestjs/common";
import { Job } from "bullmq";
import { zonedTime } from "../src/common/time";
import { JobsService } from "../src/jobs/jobs.service";
import { NotificationQueue } from "../src/notifications/notification-queue";
import { RetentionService } from "../src/notifications/retention.service";
import { api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

/** Yarın İstanbul saatiyle 03:00 (gece görevi) — mesajlar 11:00'e planlanır, test sırasında gönderilmez. */
function tomorrowNight() {
  const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return zonedTime(day, 180, "Europe/Istanbul");
}

describe("Paket bitişi ve tekrar randevu hatırlatmaları", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let retention: RetentionService;
  const night = tomorrowNight();

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Hatırlatma Salon", email: "ra@test.local" });
    const S = await createTenantWithUser(su, { name: "Başlangıç Salon", email: "rs@test.local" });
    await su.tenant.update({ where: { id: S.tenant.id }, data: { planCode: "STARTER" } });
    app = await createApp();
    a = api(app, await login(app, "ra@test.local"), A.tenant.id);
    s = await setupSalon(a);
    retention = app.get(RetentionService);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  let pkgId: string;
  it("süresi yaklaşan, seansı kalan paket için bir kez hatırlatma planlanır", async () => {
    const tpl = (await a.post("/package-templates").send({ name: "6 Seans Lazer", serviceId: s.service.id, sessionCount: 6, price: 5000, validityDays: 5 }).expect(201)).body;
    pkgId = (await a.post("/customer-packages").send({ customerId: s.customer.id, templateId: tpl.id }).expect(201)).body.id;

    const r1 = await retention.forTenant(A.tenant.id, night);
    expect(r1.packages).toBe(1);
    const n = await su.notification.findFirstOrThrow({ where: { tenantId: A.tenant.id, template: "paket_hatirlatma" } });
    expect(n.recipient).toBe("05550000001");
    expect(n.customerId).toBe(s.customer.id);
    expect((n.payload as { params: string[] }).params).toEqual(["Ayşe", "6 Seans Lazer", expect.any(String), "6", "Hatırlatma Salon"]);
    // Gece görevi mesajı gece değil, yerel 11:00'de gönderir.
    expect(n.scheduledFor.getTime()).toBe(night.getTime() + 8 * 3_600_000);

    const r2 = await retention.forTenant(A.tenant.id, night);
    expect(r2.packages).toBe(0);
    expect(await su.notification.count({ where: { template: "paket_hatirlatma" } })).toBe(1);
  });

  it("işletmenin ayarladığı gün sayısının dışında kalan paket için hatırlatma yok", async () => {
    await a.patch("/settings").send({ packageReminderDays: 2 }).expect(200);
    await su.notification.deleteMany({ where: { template: "paket_hatirlatma" } });
    expect((await retention.forTenant(A.tenant.id, night)).packages).toBe(0);
    await a.patch("/settings").send({ packageReminderDays: 7 }).expect(200);
  });

  it("pakete bağlı ileri tarihli randevusu olan müşteriye hatırlatma gitmez", async () => {
    await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(3, "10:00"), customerPackageId: pkgId }).expect(201);
    expect((await retention.forTenant(A.tenant.id, night)).packages).toBe(0);
  });

  it("planlandıktan sonra randevu alınırsa gönderim anında atlanır", async () => {
    const other = (await a.post("/customers").send({ firstName: "Zeynep", lastName: "Kaya", phone: "05550000002" }).expect(201)).body;
    const tpl = (await su.packageTemplate.findFirstOrThrow({ where: { tenantId: A.tenant.id } })).id;
    const pkg = (await a.post("/customer-packages").send({ customerId: other.id, templateId: tpl }).expect(201)).body;
    expect((await retention.forTenant(A.tenant.id, night)).packages).toBe(1);
    const n = await su.notification.findFirstOrThrow({ where: { customerId: other.id, template: "paket_hatirlatma" } });
    await a.post("/appointments").send({ customerId: other.id, staffId: s.staff2.id, serviceId: s.service.id, startsAt: futureAt(2, "12:00"), customerPackageId: pkg.id }).expect(201);
    const res = await app.get(NotificationQueue).process({ data: { notificationId: n.id }, attemptsMade: 0 } as Job<{ notificationId: string }>);
    expect(res).toBe("skipped");
    expect((await su.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("SKIPPED");
  });

  it("tekrar randevu: hizmetin tekrar süresi dolan müşteriye bir kez hatırlatma", async () => {
    await a.patch(`/services/${s.service.id}`).send({ rebookAfterDays: 30 }).expect(200);
    const c = (await a.post("/customers").send({ firstName: "Elif", lastName: "Ak", phone: "05550000003" }).expect(201)).body;
    const past = new Date(night.getTime() - 35 * 86_400_000);
    const appt = await su.appointment.create({
      data: { tenantId: A.tenant.id, customerId: c.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: past, endsAt: new Date(past.getTime() + 30 * 60_000), status: "COMPLETED", price: 1000 },
    });
    const r1 = await retention.forTenant(A.tenant.id, night);
    expect(r1.rebook).toBe(1);
    const n = await su.notification.findFirstOrThrow({ where: { template: "tekrar_randevu" } });
    expect(n.dedupeKey).toBe(`tekrar:${appt.id}`);
    expect((n.payload as { params: string[] }).params).toEqual(["Elif", "Lazer Epilasyon", "35", "Hatırlatma Salon"]);
    expect((await retention.forTenant(A.tenant.id, night)).rebook).toBe(0);
  });

  it("çok eski müşteriler ve paketinde WhatsApp olmayan işletmeler rahatsız edilmez", async () => {
    const c = (await a.post("/customers").send({ firstName: "Eski", lastName: "Müşteri", phone: "05550000004" }).expect(201)).body;
    const old = new Date(night.getTime() - 120 * 86_400_000);
    await su.appointment.create({
      data: { tenantId: A.tenant.id, customerId: c.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: old, endsAt: new Date(old.getTime() + 30 * 60_000), status: "COMPLETED", price: 1000 },
    });
    expect((await retention.forTenant(A.tenant.id, night)).rebook).toBe(0);
    const all = await retention.run(night);
    expect(all.errors).toEqual([]);
    expect(await su.notification.count({ where: { tenantId: { not: A.tenant.id } } })).toBe(0);
  });

  it("günlük görev sonucu hatırlatma sayılarını içerir", async () => {
    const r = await app.get(JobsService).runDaily({ now: night, force: true });
    expect(r).toMatchObject({ skipped: false, result: { packageReminders: 0, rebookReminders: 0 } });
  });
});
