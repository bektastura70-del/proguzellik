import { INestApplication } from "@nestjs/common";
import { addMember, api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";
import { enablePwa, portal, portalLogin } from "./portal-helpers";
import { NotificationQueue } from "../src/notifications/notification-queue";
import { MockWebPushSender } from "../src/notifications/push/web-push.sender";
import { isAllowedPushEndpoint } from "../src/notifications/push/push-endpoint";

const P256 = "B" + "A".repeat(86);
const AUTH = "C".repeat(22);
const sub = (id: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: P256, auth: AUTH } });

describe("Web Push ve uygulama içi bildirimler (Modül 3)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let rec: ReturnType<typeof api>;
  let elif: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let elifUserId: string;
  let recUserId: string;
  let customerId: string;
  let token: string;
  let outbox: MockWebPushSender["outbox"];
  const guest = { firstName: "Zeynep", lastName: "Push", phone: "0532 444 55 66", kvkkConsent: true };

  const pushRows = (appointmentId: string) => su.notification.findMany({ where: { channel: "WEBPUSH", appointmentId }, orderBy: { createdAt: "asc" } });
  const run = async (id: string, attemptsMade = 0) => app.get(NotificationQueue).process({ data: { notificationId: id }, attemptsMade } as never);
  const runAll = async (appointmentId: string, filter: (t: string) => boolean = () => true) => {
    const out: Record<string, unknown> = {};
    for (const n of await pushRows(appointmentId)) {
      if (n.status !== "QUEUED" || !filter(n.template) || n.scheduledFor > new Date(Date.now() + 1000)) continue;
      out[`${n.template}:${n.recipient.split(":")[0]}`] = await run(n.id);
    }
    return out;
  };

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Push A", email: "psa@test.local" });
    B = await createTenantWithUser(su, { name: "Push B", email: "psb@test.local" });
    app = await createApp();
    outbox = app.get(MockWebPushSender).outbox;
    a = api(app, await login(app, "psa@test.local"), A.tenant.id);
    b = api(app, await login(app, "psb@test.local"), B.tenant.id);
    s = await setupSalon(a, { duration: 60 });
    await enablePwa(su, A.tenant.id, { businessPwaEnabled: true, webPushEnabled: true });
    await enablePwa(su, B.tenant.id, { businessPwaEnabled: true, webPushEnabled: true });
    await addMember(app, a, { email: "ps.elif@test.local", fullName: "Elif Push", role: "STAFF" });
    await addMember(app, a, { email: "ps.rec@test.local", fullName: "Resepsiyon Push", role: "RECEPTION" });
    elif = api(app, await login(app, "ps.elif@test.local"), A.tenant.id);
    rec = api(app, await login(app, "ps.rec@test.local"), A.tenant.id);
    elifUserId = (await su.user.findUniqueOrThrow({ where: { email: "ps.elif@test.local" } })).id;
    recUserId = (await su.user.findUniqueOrThrow({ where: { email: "ps.rec@test.local" } })).id;
    await a.patch(`/staff/${s.staff.id}`).send({ userId: elifUserId }).expect(200);
    customerId = (await a.post("/customers").send({ firstName: "Deniz", lastName: "Bildirim", phone: "05447778899", email: "Deniz.Push@Test.local" }).expect(201)).body.id;
    token = await portalLogin(app, A.tenant.slug, "deniz.push@test.local");
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("abonelik adresi yalnızca bilinen push servisleri olabilir (SSRF koruması)", async () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost:4100/x", "https://fcm.googleapis.com.evil.com/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x"]) {
      expect(isAllowedPushEndpoint(bad)).toBe(false);
    }
    await a.post("/pwa/push/subscriptions").send({ ...sub("x"), endpoint: "https://10.0.0.5/hook" }).expect(400);
    await a.post("/pwa/push/subscriptions").send({ ...sub("x"), keys: { p256dh: "kisa", auth: AUTH } }).expect(400);
  });

  it("bayrak kapalıyken abonelik açılamaz (404); açıkken personel ve müşteri abone olur", async () => {
    await su.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { webPushEnabled: false } });
    await a.post("/pwa/push/subscriptions").send(sub("owner-1")).expect(404);
    await portal(app, A.tenant.slug, token).post("/push/subscriptions").send(sub("cust-1")).expect(404);
    expect((await a.get("/pwa/push").expect(200)).body).toMatchObject({ available: false, devices: 0 });
    await su.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { webPushEnabled: true } });
    await a.post("/pwa/push/subscriptions").send(sub("owner-1")).expect(201);
    await rec.post("/pwa/push/subscriptions").send(sub("rec-1")).expect(201);
    await elif.post("/pwa/push/subscriptions").send(sub("elif-1")).expect(201);
    await portal(app, A.tenant.slug, token).post("/push/subscriptions").send(sub("cust-1")).expect(201);
    await portal(app, A.tenant.slug).post("/push/subscriptions").send(sub("anon")).expect(401);
    expect((await a.get("/pwa/push").expect(200)).body).toMatchObject({ available: true, devices: 1 });
  });

  it("personelin oluşturduğu randevu: müşteriye 'oluşturuldu' + 24/2 saat hatırlatma; atanan personele bildirim; işlemi yapana yok", async () => {
    const appt = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(3, "11:00") }).expect(201)).body;
    const rows = await pushRows(appt.id);
    const byKey = rows.map((r) => `${r.template}:${r.recipient.split(":")[0]}`).sort();
    expect(byKey).toEqual(["push_hatirlatma_2:identity", "push_hatirlatma_24:identity", "push_isletme_atama:user", "push_randevu_olusturuldu:identity"].sort());
    expect(rows.find((r) => r.template === "push_isletme_atama")!.recipient).toBe(`user:${elifUserId}`);
    const before = outbox.length;
    expect(await runAll(appt.id)).toEqual({ "push_randevu_olusturuldu:identity": "sent", "push_isletme_atama:user": "sent" });
    const msgs = outbox.slice(before);
    const cust = msgs.find((m) => m.endpoint.endsWith("cust-1"))!;
    expect(cust.message.title).toBe("Push A");
    expect(cust.message.url).toBe(`/r/${A.tenant.slug}/uygulama?sekme=randevularim`);
    // Kilit ekranında görünebilir: müşteri adı, telefon, e-posta, hizmet adı yok
    expect(JSON.stringify(msgs)).not.toMatch(/Deniz|Bildirim|0544|@|Lazer/);
    const staffInApp = await su.inAppNotification.findMany({ where: { appointmentId: appt.id } });
    expect(staffInApp.map((n) => [n.userId, n.type])).toEqual([[elifUserId, "appointment.assigned"]]);
    expect(staffInApp[0].body).toMatch(/^Deniz B\. · /);
    // Hatırlatma TTL'i randevu saatini aşmaz
    await su.notification.updateMany({ where: { appointmentId: appt.id, template: "push_hatirlatma_24" }, data: { scheduledFor: new Date() } });
    const r24 = (await pushRows(appt.id)).find((r) => r.template === "push_hatirlatma_24")!;
    expect(await run(r24.id)).toBe("sent");
    const ttl = outbox[outbox.length - 1].ttl;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(Math.ceil((new Date(appt.startsAt).getTime() - Date.now()) / 1000));
  });

  it("aynı olay iki kez planlanmaz (dedupe) ve bir kez gönderilen bildirim tekrar gönderilmez", async () => {
    const appt = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(4, "11:00") }).expect(201)).body;
    const { PushPlanner } = await import("../src/notifications/push/push.planner");
    const { PrismaService } = await import("../src/prisma/prisma.service");
    await app.get(PrismaService).withTenant({ tenantId: A.tenant.id, userId: A.user.id }, (tx) => app.get(PushPlanner).plan(tx, appt.id, "created", "STAFF", { actorId: A.user.id }));
    expect((await pushRows(appt.id)).length).toBe(4);
    const created = (await pushRows(appt.id)).find((r) => r.template === "push_randevu_olusturuldu")!;
    expect(await run(created.id)).toBe("sent");
    expect(await run(created.id)).toBe("skipped");
  });

  it("saat değişince eski hatırlatmalar iptal, yenileri planlanır; müşteriye 'değişti' gider", async () => {
    const appt = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(5, "11:00") }).expect(201)).body;
    await a.patch(`/appointments/${appt.id}`).send({ startsAt: futureAt(5, "15:00") }).expect(200);
    const rows = await pushRows(appt.id);
    const reminders = rows.filter((r) => r.template.startsWith("push_hatirlatma"));
    expect(reminders.filter((r) => r.status === "SKIPPED")).toHaveLength(2);
    expect(reminders.filter((r) => r.status === "QUEUED")).toHaveLength(2);
    expect(rows.some((r) => r.template === "push_randevu_degisti" && r.status === "QUEUED")).toBe(true);
    // Eski saatli bir bildirim yine de işçiye düşerse gönderilmez
    const created = rows.find((r) => r.template === "push_randevu_olusturuldu")!;
    expect(await run(created.id)).toBe("skipped");
    expect((await su.notification.findUniqueOrThrow({ where: { id: created.id } })).error).toBe("Randevu saati değişti");
  });

  it("personel iptal ederse bekleyen hatırlatmalar düşer, müşteriye iptal bildirimi gider (randevu iptalken de)", async () => {
    const appt = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(6, "11:00") }).expect(201)).body;
    await a.post(`/appointments/${appt.id}/status`).send({ status: "CANCELLED" }).expect(201);
    const rows = await pushRows(appt.id);
    expect(rows.filter((r) => r.template.startsWith("push_hatirlatma")).every((r) => r.status === "SKIPPED")).toBe(true);
    const cancel = rows.find((r) => r.template === "push_randevu_iptal")!;
    expect(await run(cancel.id)).toBe("sent");
  });

  it("müşteri portaldan randevu alırsa: müşteriye 'alındı' gider; masa rolleri 'yeni randevu', atanan personel 'size atandı' alır", async () => {
    const r = await portal(app, A.tenant.slug, token).post("/bookings").set("Idempotency-Key", "push-key-0001").send({ ...guest, serviceId: s.service.id, staffId: s.staff.id, startsAt: futureAt(7, "11:00") }).expect(201);
    const id = r.body.bookingId;
    const rows = await pushRows(id);
    const own = rows.filter((x) => x.template === "push_randevu_olusturuldu");
    expect(own).toHaveLength(1);
    expect((own[0].payload as { body: string }).body).toMatch(/^Randevunuz alındı: /);
    expect(rows.filter((x) => x.template.startsWith("push_hatirlatma"))).toHaveLength(2);
    const inApp = await su.inAppNotification.findMany({ where: { appointmentId: id } });
    const map = Object.fromEntries(inApp.map((n) => [n.userId, n.type]));
    expect(map).toEqual({ [A.user.id]: "appointment.new", [recUserId]: "appointment.new", [elifUserId]: "appointment.assigned" });
    // Personel yalnızca kendi bildirimlerini görür
    const mine = (await elif.get("/pwa/notifications").expect(200)).body.items;
    const appts = await su.appointment.findMany({ where: { id: { in: mine.map((n: { appointmentId: string }) => n.appointmentId) } }, select: { staffId: true } });
    expect(appts.length).toBeGreaterThan(0);
    expect(appts.every((x) => x.staffId === s.staff.id)).toBe(true);
    expect(mine.some((n: { type: string }) => n.type === "appointment.new")).toBe(false);
  });

  it("müşteri portaldan iptal ederse işletmeye 'müşteri iptal etti' bildirimi; tercihi kapalı olana gitmez", async () => {
    await rec.patch("/pwa/preferences").send({ cancellations: false }).expect(200);
    const r = await portal(app, A.tenant.slug, token).post("/bookings").set("Idempotency-Key", "push-key-0002").send({ ...guest, serviceId: s.service.id, staffId: s.staff.id, startsAt: futureAt(8, "11:00") }).expect(201);
    await portal(app, A.tenant.slug, token).post(`/appointments/${r.body.bookingId}/cancel`).expect(200);
    const inApp = await su.inAppNotification.findMany({ where: { appointmentId: r.body.bookingId, type: "appointment.customer_cancelled" } });
    expect(inApp.map((n) => n.userId).sort()).toEqual([A.user.id, elifUserId].sort());
    const rows = await pushRows(r.body.bookingId);
    expect(rows.filter((x) => x.template === "push_randevu_iptal")).toHaveLength(1);
    const staffCancel = rows.filter((x) => x.template === "push_isletme_musteri_iptal");
    expect(staffCancel.map((x) => x.recipient).sort()).toEqual([`user:${A.user.id}`, `user:${elifUserId}`].sort());
    await rec.patch("/pwa/preferences").send({ cancellations: true }).expect(200);
  });

  it("müşteri hatırlatmaları kapatırsa gönderim anında atlanır", async () => {
    const appt = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(9, "11:00") }).expect(201)).body;
    await portal(app, A.tenant.slug, token).patch("/me").send({ notifyReminders: false }).expect(200);
    const r2 = (await pushRows(appt.id)).find((r) => r.template === "push_hatirlatma_2")!;
    expect(await run(r2.id)).toBe("skipped");
    expect((await su.notification.findUniqueOrThrow({ where: { id: r2.id } })).error).toMatch(/kapattı/);
    await portal(app, A.tenant.slug, token).patch("/me").send({ notifyReminders: true }).expect(200);
  });

  it("410 dönen abonelik devre dışı kalır; geçici hata yeniden denenir, başarısız sayısı artar", async () => {
    const mock = app.get(MockWebPushSender);
    const appt = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(10, "11:00") }).expect(201)).body;
    const created = (await pushRows(appt.id)).find((r) => r.template === "push_randevu_olusturuldu")!;
    mock.failures.set(sub("cust-1").endpoint, 500);
    await expect(run(created.id)).rejects.toThrow(/mock 500/);
    expect((await su.pushSubscription.findFirstOrThrow({ where: { endpoint: sub("cust-1").endpoint } })).failures).toBe(1);
    mock.failures.set(sub("cust-1").endpoint, 410);
    expect(await run(created.id, 1)).toBe("skipped");
    const s1 = await su.pushSubscription.findFirstOrThrow({ where: { endpoint: sub("cust-1").endpoint } });
    expect(s1.revokedAt).not.toBeNull();
    mock.failures.clear();
    await portal(app, A.tenant.slug, token).post("/push/subscriptions").send(sub("cust-1")).expect(201);
  });

  it("paylaşılan cihaz: aynı tarayıcıya başka kullanıcı abone olursa eski sahibin aboneliği kalkar; kaldırma yalnız sahibine", async () => {
    await rec.post("/pwa/push/subscriptions").send(sub("shared-tablet")).expect(201);
    await elif.post("/pwa/push/subscriptions").send(sub("shared-tablet")).expect(201);
    const rows = await su.pushSubscription.findMany({ where: { endpoint: sub("shared-tablet").endpoint } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(elifUserId);
    expect((await rec.delete("/pwa/push/subscriptions").send({ endpoint: sub("shared-tablet").endpoint }).expect(200)).body.removed).toBe(0);
    expect((await elif.delete("/pwa/push/subscriptions").send({ endpoint: sub("shared-tablet").endpoint }).expect(200)).body.removed).toBe(1);
  });

  it("kiracı yalıtımı: B işletmesi A'nın aboneliğini göremez/silemez; A'nın randevusu B'ye bildirim üretmez", async () => {
    expect((await b.delete("/pwa/push/subscriptions").send({ endpoint: sub("owner-1").endpoint }).expect(200)).body.removed).toBe(0);
    expect(await su.pushSubscription.count({ where: { endpoint: sub("owner-1").endpoint, tenantId: A.tenant.id } })).toBe(1);
    expect(await su.inAppNotification.count({ where: { tenantId: B.tenant.id } })).toBe(0);
    expect(await su.notification.count({ where: { tenantId: B.tenant.id, channel: "WEBPUSH" } })).toBe(0);
  });

  it("deneme bildirimi yalnızca kullanıcının kendi cihazına gider", async () => {
    const before = outbox.length;
    const r = await a.post("/pwa/push/test").expect(202);
    expect(await run(r.body.id)).toBe("sent");
    expect(outbox.slice(before).map((m) => m.endpoint)).toEqual([sub("owner-1").endpoint]);
  });

  it("web_push_enabled kapalıyken push kaydı yazılmaz, işletme bildirim merkezi çalışmaya devam eder; bekleyenler gönderilmez", async () => {
    const pending = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(11, "11:00") }).expect(201)).body;
    await su.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { webPushEnabled: false } });
    const appt = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(12, "11:00") }).expect(201)).body;
    expect(await pushRows(appt.id)).toHaveLength(0);
    expect(await su.inAppNotification.count({ where: { appointmentId: appt.id } })).toBe(1);
    const created = (await pushRows(pending.id)).find((r) => r.template === "push_randevu_olusturuldu")!;
    expect(await run(created.id)).toBe("skipped");
    await su.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { webPushEnabled: true } });
  });

  it("WhatsApp bildirim listesi Web Push kayıtlarını göstermez", async () => {
    const r = await a.get("/notifications").expect((x) => expect([200, 403]).toContain(x.status));
    if (r.status === 200) expect(r.body.every((n: { channel: string }) => n.channel === "WHATSAPP")).toBe(true);
  });
});
