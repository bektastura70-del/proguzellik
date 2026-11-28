import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { NotificationQueue } from "../src/notifications/notification-queue";
import { DisabledWhatsAppProvider, WhatsAppProvider } from "../src/notifications/whatsapp.provider";
import { addMember, api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

/**
 * Gerçek salon (28.11): WhatsApp bağlamak istemeyen, salon uygulaması (PWA) pilotu kapalı işletme.
 * Online randevu alındığı anda geçerlidir; salon panelde onay bekleyenleri görür, onaylar / reddeder / başka saat verir.
 * Karar, online formda e-posta yazan müşteriye e-postayla gider. WhatsApp kaydı hiç açılmaz (hata satırı oluşmaz).
 * Canlıdaki gibi platform WhatsApp sağlayıcısı kapalıdır (DisabledWhatsAppProvider).
 */
describe("WhatsApp'sız salon: onay bekleyenler, onay/ret/saat değişikliği e-postası", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let staffApi: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let slug: string;
  let queue: NotificationQueue;
  const http = () => request(app.getHttpServer());
  const run = (id: string) => queue.process({ data: { notificationId: id }, attemptsMade: 0 } as never);
  const book = (startsAt: string, extra: Record<string, unknown> = {}) =>
    http()
      .post(`/public/salons/${slug}/bookings`)
      .send({ serviceId: s.service.id, startsAt, firstName: "Ayşe", lastName: "Demir", phone: "0532 444 55 66", kvkkConsent: true, ...extra })
      .expect(201);
  const customerMails = (appointmentId: string, template: string) => su.notification.findMany({ where: { appointmentId, channel: "EMAIL", template } });

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Ahmet Berber", email: "sahip@berber.test" });
    slug = A.tenant.slug;
    app = await createApp((b) => b.overrideProvider(WhatsAppProvider).useValue(new DisabledWhatsAppProvider()));
    queue = app.get(NotificationQueue);
    a = api(app, await login(app, "sahip@berber.test"), A.tenant.id);
    s = await setupSalon(a, { duration: 30, price: 300 });
    await addMember(app, a, { email: "usta@berber.test", fullName: "Usta Kişi", role: "STAFF" });
    const { plan } = await su.tenant.findUniqueOrThrow({ where: { id: A.tenant.id }, include: { plan: true } });
    // Paket WhatsApp'ı içeriyor ama bağlantı yok: eskiden her randevuda atlanan WhatsApp kaydı açılıyordu.
    expect(plan.features).toContain("WHATSAPP");
    expect(await su.channelConnection.count({ where: { tenantId: A.tenant.id } })).toBe(0);
    expect(await su.tenantPwaSettings.count({ where: { tenantId: A.tenant.id } })).toBe(0);
    const usta = await su.user.findUniqueOrThrow({ where: { email: "usta@berber.test" } });
    await su.staffMember.update({ where: { id: s.staff2.id }, data: { userId: usta.id } });
    staffApi = api(app, await login(app, "usta@berber.test"), A.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  let withEmail: string;
  let noEmail: string;
  it("online randevu WhatsApp kaydı açmaz; onay bekleyenler pilot kapalıyken de listelenir", async () => {
    withEmail = (await book(futureAt(5, "10:00"), { email: "ayse@musteri.test", staffId: s.staff.id })).body.bookingId;
    noEmail = (await book(futureAt(5, "11:00"), { phone: "05445556677", firstName: "Can", lastName: "Yıldız", staffId: s.staff2.id })).body.bookingId;
    expect(await su.notification.count({ where: { tenantId: A.tenant.id, channel: "WHATSAPP" } })).toBe(0);

    // Eski uç nokta salon uygulaması pilotuna bağlı kalır; panel yeni uç noktayı kullanır.
    await a.get("/pwa/pending").expect(404);
    const r = await a.get("/appointments/pending").expect(200);
    const byId = Object.fromEntries(r.body.map((x: any) => [x.id, x]));
    expect(byId[withEmail]).toMatchObject({ status: "BOOKED", source: "ONLINE", customerEmail: true, customer: { firstName: "Ayşe" } });
    expect(byId[noEmail]).toMatchObject({ customerEmail: false, customer: { phone: "05445556677" } });
    expect(byId[withEmail].staff.userId).toBeUndefined();

    // Personel yalnız kendisine atananı görür.
    const mine = await staffApi.get("/appointments/pending").expect(200);
    expect(mine.body.map((x: any) => x.id)).toEqual([noEmail]);

    const one = await a.get(`/appointments/${withEmail}`).expect(200);
    expect(one.body).toMatchObject({ id: withEmail, customerEmail: true, service: { name: "Lazer Epilasyon" } });
  });

  it("salon onaylayınca müşteriye 'onaylandı' e-postası gider; listeden düşer", async () => {
    await a.post(`/appointments/${withEmail}/status`).send({ status: "CONFIRMED" }).expect(201);
    const [m] = await customerMails(withEmail, "eposta_musteri_randevu_onaylandi");
    expect(m.recipient).toBe("ayse@musteri.test");
    expect(await run(m.id)).toBe("sent");
    const out = await su.outboundEmail.findFirstOrThrow({ where: { to: "ayse@musteri.test", template: "booking_confirmed_customer" } });
    expect(out.subject).toContain("randevunuz onaylandı");
    expect(out.body).toContain("Merhaba Ayşe");
    expect(out.body).toContain(`/r/${slug}/iptal?id=${withEmail}`);
    const r = await a.get("/appointments/pending").expect(200);
    expect(r.body.map((x: any) => x.id)).not.toContain(withEmail);
    // Müşteri sayfasındaki durum da güncel
    const pub = await su.appointment.findUniqueOrThrow({ where: { id: withEmail } });
    expect(pub.status).toBe("CONFIRMED");
  });

  it("salon saati değiştirince ('başka saat') yeni ve eski saatle e-posta gider; arka arkaya taşımada yalnız son saat", async () => {
    await a.patch(`/appointments/${withEmail}`).send({ startsAt: futureAt(5, "14:00") }).expect(200);
    await a.patch(`/appointments/${withEmail}`).send({ startsAt: futureAt(5, "15:00") }).expect(200);
    const rows = await customerMails(withEmail, "eposta_musteri_saat_degisti");
    expect(rows.map((r) => r.status).sort()).toEqual(["QUEUED", "SKIPPED"]);
    const last = rows.find((r) => r.status === "QUEUED")!;
    expect(await run(last.id)).toBe("sent");
    const out = await su.outboundEmail.findFirstOrThrow({ where: { to: "ayse@musteri.test", template: "booking_rescheduled_customer" } });
    expect(out.body).toContain("15:00");
    expect(out.body).toContain("14:00");
    // Not değişikliği saat değiştirmez: e-posta gitmez.
    await a.patch(`/appointments/${withEmail}`).send({ notes: "kısa kesim" }).expect(200);
    expect(await customerMails(withEmail, "eposta_musteri_saat_degisti")).toHaveLength(2);
  });

  it("salon reddedince gerekçeli iptal e-postası ve yeniden randevu bağlantısı gider; bekleyen saat e-postası durur", async () => {
    await a.patch(`/appointments/${withEmail}`).send({ startsAt: futureAt(5, "16:00") }).expect(200);
    await a.post(`/appointments/${withEmail}/status`).send({ status: "CANCELLED", reason: "Uzman bu saatte müsait değil" }).expect(201);
    // İptalden önce kuyrukta bekleyen "saat değişti" e-postası artık gönderilmez.
    const moves = await customerMails(withEmail, "eposta_musteri_saat_degisti");
    expect(moves.filter((r) => r.status === "QUEUED")).toHaveLength(0);
    const [m] = await customerMails(withEmail, "eposta_musteri_salon_iptal");
    expect(await run(m.id)).toBe("sent");
    const out = await su.outboundEmail.findFirstOrThrow({ where: { to: "ayse@musteri.test", template: "booking_declined_customer" } });
    expect(out.body).toContain("Uzman bu saatte müsait değil");
    expect(out.body).toContain(`/r/${slug}`);
    // Müşteri iptal ettiğinde salon iptal e-postası gitmez (yalnız işletmeye bildirim).
    expect(await su.notification.count({ where: { appointmentId: withEmail, template: "eposta_isletme_musteri_iptal" } })).toBe(0);
  });

  it("e-posta vermeyen müşteride salon kararı e-posta açmaz; personel kendi randevusunu onaylayabilir", async () => {
    await staffApi.post(`/appointments/${noEmail}/status`).send({ status: "CONFIRMED" }).expect(201);
    expect(await su.notification.count({ where: { appointmentId: noEmail, channel: "EMAIL", template: { startsWith: "eposta_musteri" } } })).toBe(0);
    expect(await su.notification.count({ where: { tenantId: A.tenant.id, channel: "WHATSAPP" } })).toBe(0);
  });

  it("panelden açılan randevuda (form e-postası yok) müşteri kaydında e-posta olsa da salon kararı e-postası gitmez", async () => {
    const c = await a.post("/customers").send({ firstName: "Kayıtlı", lastName: "Müşteri", phone: "05301112233", email: "kayitli@musteri.test", kvkkConsent: true }).expect(201);
    const appt = await a.post("/appointments").send({ customerId: c.body.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(6, "10:00") }).expect(201);
    // Salonun kendi açtığı randevu onay bekleyenler listesinde görünmez.
    expect((await a.get("/appointments/pending").expect(200)).body.map((x: any) => x.id)).not.toContain(appt.body.id);
    await a.post(`/appointments/${appt.body.id}/status`).send({ status: "CONFIRMED" }).expect(201);
    expect(await su.notification.count({ where: { appointmentId: appt.body.id, channel: "EMAIL" } })).toBe(0);
  });

  it("WhatsApp bağlıysa (doğrulanmış numara) WhatsApp kaydı yine açılır", async () => {
    await su.channelConnection.create({
      data: { tenantId: A.tenant.id, channel: "WHATSAPP", status: "CONNECTED", managed: true, externalId: "123456", businessAccountId: "654321", accessTokenEnc: "", tokenLast4: "", appSecretEnc: "", verifyTokenEnc: "x" },
    });
    const id = (await book(futureAt(7, "10:00"), { phone: "05467778899", firstName: "Deniz", lastName: "Ak" })).body.bookingId;
    const wa = await su.notification.findMany({ where: { appointmentId: id, channel: "WHATSAPP" } });
    expect(wa.map((n) => n.template)).toContain("randevu_onay");
    await su.notification.deleteMany({ where: { tenantId: A.tenant.id, channel: "WHATSAPP" } });
    await su.channelConnection.deleteMany({ where: { tenantId: A.tenant.id } });
  });
});
