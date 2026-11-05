import { INestApplication } from "@nestjs/common";
import { Job } from "bullmq";
import request from "supertest";
import { zonedTime } from "../src/common/time";
import { loadEnv } from "../src/config/env";
import { MockEmailProvider } from "../src/email/email.provider";
import { JobsService } from "../src/jobs/jobs.service";
import { NotificationQueue } from "../src/notifications/notification-queue";
import { RenewalService, renewalOptOutToken } from "../src/notifications/renewal.service";
import { RetentionService } from "../src/notifications/retention.service";
import { addMember, api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";
import { enablePwa } from "./portal-helpers";

const DAY = 86_400_000;
const TZ = "Europe/Istanbul";
/** Yarın İstanbul saatiyle 03:00 (gece görevi); hatırlatmalar 11:00'e planlanır, test sırasında işçi göndermez. */
const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
const night = zonedTime(tomorrow, 180, TZ);
/** "Yarın"dan n gün önce saat 10:00 (yerel) */
const daysBefore = (n: number) => zonedTime(new Date(Date.parse(`${tomorrow}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10), 600, TZ);

const setFlag = (v: "1" | undefined) => {
  (loadEnv() as { RENEWAL_REMINDERS?: string }).RENEWAL_REMINDERS = v;
};

describe("Yenilenme hatırlatması", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let renewal: RenewalService;
  let queue: NotificationQueue;
  const deliver = (id: string, attemptsMade = 0) => queue.process({ data: { notificationId: id }, attemptsMade } as Job<{ notificationId: string }>);

  /** Tamamlanmış işlem kaydı (geçmiş tarihli randevular API ile oluşturulamaz) */
  let slot = 0;
  const done = (customerId: string, day: Date, serviceId = s.service.id) => {
    // Aynı personelde çakışma olmasın: aynı gün içinde her kayıt ayrı yarım saatte (10:00-18:00)
    const at = new Date(day.getTime() + (slot++ % 16) * 30 * 60_000);
    return su.appointment.create({ data: { tenantId: A.tenant.id, customerId, staffId: s.staff.id, serviceId, startsAt: at, endsAt: new Date(at.getTime() + 30 * 60_000), status: "COMPLETED", price: 1000 } });
  };
  const customer = async (firstName: string, phone: string, extra: Record<string, unknown> = {}) =>
    (await a.post("/customers").send({ firstName, lastName: "Test", phone, email: `${firstName.toLowerCase()}@musteri.test`, marketingConsent: true, ...extra }).expect(201)).body as { id: string };

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Yenileme Salon", email: "yen-a@test.local" });
    B = await createTenantWithUser(su, { name: "Diğer Salon", email: "yen-b@test.local" });
    app = await createApp();
    a = api(app, await login(app, "yen-a@test.local"), A.tenant.id);
    b = api(app, await login(app, "yen-b@test.local"), B.tenant.id);
    s = await setupSalon(a);
    renewal = app.get(RenewalService);
    queue = app.get(NotificationQueue);
  });
  afterAll(async () => {
    setFlag(undefined);
    await app.close();
    await su.$disconnect();
  });

  it("hizmet ayarı: hatırlatma günü tekrar süresinden kısa olmalı, tekrar süresi olmadan girilemez", async () => {
    await a.patch(`/services/${s.service.id}`).send({ renewalRemindDaysBefore: 7 }).expect(400);
    await a.patch(`/services/${s.service.id}`).send({ rebookAfterDays: 45, renewalRemindDaysBefore: 45 }).expect(400);
    const r = await a.patch(`/services/${s.service.id}`).send({ rebookAfterDays: 45, renewalRemindDaysBefore: 7 }).expect(200);
    expect(r.body).toMatchObject({ rebookAfterDays: 45, renewalRemindDaysBefore: 7 });
  });

  it("varsayılan KAPALI: ortam anahtarı yokken hiçbir şey planlanmaz, liste ve işletme ayarı kullanılamaz", async () => {
    const c = await customer("Kapali", "05551110000");
    await done(c.id, daysBefore(40));
    expect(await renewal.forTenant(A.tenant.id, night)).toBe(0);
    expect((await renewal.run(night)).renewalReminders).toBe(0);
    await a.get("/renewals").expect(404);
    await a.patch("/settings").send({ renewalRemindersEnabled: true }).expect(409);
    expect((await a.get("/settings").expect(200)).body).toMatchObject({ renewalRemindersEnabled: false, features: { renewalReminders: false } });
    await su.appointment.deleteMany({ where: { customerId: c.id } });
  });

  it("ortam açık, işletme ayarı kapalıyken planlanmaz; ayarı açmak denetim kaydına yazılır", async () => {
    setFlag("1");
    const c = await customer("Ayarsiz", "05551110001");
    await done(c.id, daysBefore(40));
    expect(await renewal.forTenant(A.tenant.id, night)).toBe(0);
    await su.appointment.deleteMany({ where: { customerId: c.id } });

    await a.patch("/settings").send({ renewalRemindersEnabled: true }).expect(200);
    const log = await su.auditLog.findFirstOrThrow({ where: { tenantId: A.tenant.id, action: "tenant.renewal_reminders_changed" } });
    expect(log.metadata).toEqual({ from: false, to: true });
    expect(log.actorId).toBe(A.user.id);
  });

  let mainCustomer: { id: string };
  let mainAppt: { id: string };
  let emailNotif: string;
  it("hatırlatma günü gelen müşteriye e-posta + uygulama bildirimi bir kez planlanır (11:00'de)", async () => {
    await enablePwa(su, A.tenant.id, { webPushEnabled: true });
    mainCustomer = await customer("Selin", "05551110002");
    mainAppt = await done(mainCustomer.id, daysBefore(40)); // yenileme: yarın+5, hatırlatma: yarın-2
    const identity = await su.customerIdentity.create({ data: { tenantId: A.tenant.id, email: "selin@musteri.test", verifiedAt: new Date() } });
    await su.pushSubscription.create({ data: { tenantId: A.tenant.id, audience: "CUSTOMER", identityId: identity.id, endpoint: "https://push.example.test/abc", p256dh: "k", auth: "a" } });

    expect(await renewal.forTenant(A.tenant.id, night)).toBe(2);
    const rows = await su.notification.findMany({ where: { tenantId: A.tenant.id, template: "yenileme_hatirlatma" }, orderBy: { channel: "asc" } });
    expect(rows.map((r) => [r.channel, r.recipient, r.kind, r.dedupeKey, r.appointmentId])).toEqual([
      ["EMAIL", "selin@musteri.test", "MARKETING", `yenile:${mainAppt.id}:EMAIL`, null],
      ["WEBPUSH", `identity:${identity.id}`, "MARKETING", `yenile:${mainAppt.id}:WEBPUSH:${identity.id}`, null],
    ]);
    for (const r of rows) expect(r.scheduledFor.getTime()).toBe(night.getTime() + 8 * 3_600_000);
    // Kilit ekranında görünebilecek push metninde müşteri adı ve hizmet adı yok
    const push = rows[1].payload as { body: string; title: string };
    expect(push.body).not.toMatch(/Selin|Lazer/);
    emailNotif = rows[0].id;

    // Gece görevi tekrar çalışırsa çift kayıt yok
    expect(await renewal.forTenant(A.tenant.id, night)).toBe(0);
    expect(await su.notification.count({ where: { template: "yenileme_hatirlatma" } })).toBe(2);
  });

  it("e-posta gönderimi: vazgeçme bağlantısı imzalı, kayıt SENT olur; uygulama bildirimi de gider", async () => {
    const outbox = app.get(MockEmailProvider).outbox;
    const before = outbox.length;
    expect(await deliver(emailNotif)).toBe("sent");
    const mail = outbox[outbox.length - 1];
    expect(outbox.length).toBe(before + 1);
    expect(mail.to).toBe("selin@musteri.test");
    expect(mail.subject).toContain("Lazer Epilasyon");
    expect(mail.text).toContain(`/hatirlatma-kapat?t=${encodeURIComponent(renewalOptOutToken(A.tenant.id, mainCustomer.id))}`);
    expect((await su.notification.findUniqueOrThrow({ where: { id: emailNotif } })).status).toBe("SENT");

    const push = await su.notification.findFirstOrThrow({ where: { channel: "WEBPUSH", template: "yenileme_hatirlatma" } });
    expect(await deliver(push.id)).toBe("sent");
    // Gönderilmiş bildirim yeniden işlenirse tekrar gönderilmez
    expect(await deliver(emailNotif)).toBe("skipped");
    expect(outbox.length).toBe(before + 1);
  });

  it("izni olmayan, vazgeçmiş, tarihi geçmiş, günü gelmemiş ya da zaten randevulu müşteriye planlanmaz", async () => {
    await su.notification.deleteMany({});
    const noConsent = await customer("Izinsiz", "05551110003", { marketingConsent: false });
    await done(noConsent.id, daysBefore(40));
    const optedOut = await customer("Vazgecen", "05551110004");
    await a.patch(`/customers/${optedOut.id}`).send({ renewalRemindersOptOut: true }).expect(200);
    await done(optedOut.id, daysBefore(40));
    const overdue = await customer("Gecikmis", "05551110005");
    await done(overdue.id, daysBefore(46)); // yenileme günü dün
    const early = await customer("Erken", "05551110006");
    await done(early.id, daysBefore(30)); // hatırlatma günü yarın+8
    const booked = await customer("Randevulu", "05551110007");
    await done(booked.id, daysBefore(40));
    await a.post("/appointments").send({ customerId: booked.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(3, "10:00") }).expect(201);
    const later = await customer("Yenilenmis", "05551110008");
    await done(later.id, daysBefore(80));
    await done(later.id, daysBefore(10)); // son işlem yakın: döngü yeniden başladı

    await su.notification.deleteMany({ where: { customerId: mainCustomer.id } });
    await su.customer.update({ where: { id: mainCustomer.id }, data: { email: null } }); // ana müşteri bu testte yer almasın
    await su.customerIdentity.deleteMany({});
    expect(await renewal.forTenant(A.tenant.id, night)).toBe(0);

    const log = await su.auditLog.findFirstOrThrow({ where: { tenantId: A.tenant.id, entityId: optedOut.id, action: "customer.consent_changed" } });
    expect(log.metadata).toMatchObject({ renewalRemindersOptOut: { from: false, to: true }, via: "panel" });
  });

  it("planlandıktan sonra randevu alınırsa, müşteri vazgeçerse ya da izin geri çekilirse gönderim anında atlanır", async () => {
    const mk = async (name: string, phone: string) => {
      const c = await customer(name, phone);
      await done(c.id, daysBefore(40));
      return c;
    };
    const c1 = await mk("Sonradan", "05551110009");
    const c2 = await mk("Linkten", "05551110010");
    const c3 = await mk("Geri", "05551110011");
    expect(await renewal.forTenant(A.tenant.id, night)).toBe(3);
    const n = async (id: string) => su.notification.findFirstOrThrow({ where: { customerId: id, template: "yenileme_hatirlatma" } });

    await a.post("/appointments").send({ customerId: c1.id, staffId: s.staff2.id, serviceId: s.service.id, startsAt: futureAt(4, "12:00") }).expect(201);
    expect(await deliver((await n(c1.id)).id)).toBe("skipped");
    expect((await n(c1.id)).error).toBe("Müşteri zaten randevu almış ya da yeni işlem yapılmış");

    // E-postadaki bağlantıyla vazgeçme (oturum gerekmez); geçersiz imza reddedilir
    const http = () => request(app.getHttpServer());
    const token = renewalOptOutToken(A.tenant.id, c2.id);
    await http().post("/public/renewal-reminders/opt-out").send({ token: token.slice(0, -2) + "xx" }).expect(400);
    await http().post("/public/renewal-reminders/opt-out").send({ token: renewalOptOutToken(B.tenant.id, c2.id).replace(/\.[^.]+$/, token.slice(token.lastIndexOf("."))) }).expect(400);
    const r = await http().post("/public/renewal-reminders/opt-out").send({ token }).expect(200);
    expect(r.body).toEqual({ ok: true, salon: "Yenileme Salon" });
    await http().post("/public/renewal-reminders/opt-out").send({ token }).expect(200); // tekrar: değişiklik yok
    expect(await su.auditLog.count({ where: { entityId: c2.id, action: "customer.consent_changed" } })).toBe(1);
    expect((await su.customer.findUniqueOrThrow({ where: { id: c2.id } })).renewalRemindersOptOutAt).not.toBeNull();
    expect(await deliver((await n(c2.id)).id)).toBe("skipped");
    expect((await n(c2.id)).error).toBe("Müşteri hatırlatmaları kapattı");

    await a.patch(`/customers/${c3.id}`).send({ marketingConsent: false }).expect(200);
    expect(await deliver((await n(c3.id)).id)).toBe("skipped");
    expect((await n(c3.id)).error).toBe("Ticari ileti izni yok");
  });

  it("işletme ayarı kapatılırsa ya da ortam anahtarı kapanırsa bekleyen hatırlatma gönderilmez", async () => {
    const c = await customer("Bekleyen", "05551110012");
    await done(c.id, daysBefore(40));
    expect(await renewal.forTenant(A.tenant.id, night)).toBe(1);
    const n = await su.notification.findFirstOrThrow({ where: { customerId: c.id } });
    setFlag(undefined);
    expect(await deliver(n.id)).toBe("skipped");
    expect((await su.notification.findUniqueOrThrow({ where: { id: n.id } })).error).toBe("Yenilenme hatırlatması kapalı");
    setFlag("1");
  });

  it("e-posta geçici hatası yeniden denenir, son denemede FAILED olur", async () => {
    const c = await customer("Hatali", "05551110013");
    await done(c.id, daysBefore(40));
    await renewal.forTenant(A.tenant.id, night);
    const n = await su.notification.findFirstOrThrow({ where: { customerId: c.id } });
    const mock = app.get(MockEmailProvider);
    const spy = jest.spyOn(mock, "send").mockRejectedValue(new Error("SMTP zaman aşımı"));
    await expect(deliver(n.id, 0)).rejects.toThrow("E-posta gönderilemedi");
    expect((await su.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("QUEUED");
    await expect(deliver(n.id, 4)).rejects.toThrow();
    expect((await su.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("FAILED");
    spy.mockRestore();
  });

  it("panel listesi: yaklaşan müşteriler durumlarıyla; başka işletme göremez; personel rolü erişemez", async () => {
    const r = await a.get("/renewals?days=30").expect(200);
    expect(r.body.enabled).toBe(true);
    const names = r.body.items.map((i: { customer: { name: string } }) => i.customer.name);
    expect(names).toEqual(expect.arrayContaining(["Selin Test", "Izinsiz Test", "Vazgecen Test", "Erken Test", "Randevulu Test", "Gecikmis Test"]));
    expect(names).not.toContain("Yenilenmis Test");
    const by = (n: string) => r.body.items.find((i: { customer: { name: string } }) => i.customer.name === n);
    expect(by("Izinsiz Test")).toMatchObject({ reminder: "NO_CONSENT", daysLeft: 6, service: { name: "Lazer Epilasyon" }, customer: { phone: "05551110003" } });
    expect(by("Vazgecen Test").reminder).toBe("OPTED_OUT");
    expect(by("Erken Test").reminder).toBe("WAITING");
    expect(by("Randevulu Test")).toMatchObject({ reminder: "BOOKED", upcoming: { id: expect.any(String) } });
    expect(by("Gecikmis Test").reminder).toBe("OVERDUE");
    expect(by("Selin Test").reminder).toBe("PENDING"); // kayıtları önceki testte silindi, e-postası kaldırıldı

    // Başka işletme: kendi verisi yok, A'nın müşterilerini görmez
    expect((await b.get("/renewals").expect(200)).body.items).toEqual([]);
    await addMember(app, a, { email: "yen-staff@test.local", fullName: "Personel", role: "STAFF" });
    await api(app, await login(app, "yen-staff@test.local"), A.tenant.id).get("/renewals").expect(403);
  });

  it("yenilenme açıkken eski WhatsApp 'tekrar randevu' mesajı da gitmez; günlük görev sonucu sayıyı içerir", async () => {
    await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "SMART" } });
    const c = await customer("Eski", "05551110014");
    await done(c.id, daysBefore(50)); // tekrar süresi (45) dolmuş
    expect((await app.get(RetentionService).forTenant(A.tenant.id, night)).rebook).toBe(0);
    const run = await app.get(JobsService).runDaily({ now: night, force: true });
    expect(run).toMatchObject({ skipped: false, result: { renewalReminders: expect.any(Number), errors: [] } });
  });
});
