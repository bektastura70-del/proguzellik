import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { canonicalPhone, phoneVariants } from "../src/common/phone";
import { NotificationQueue } from "../src/notifications/notification-queue";
import { MockWhatsAppProvider } from "../src/notifications/whatsapp.provider";
import { addMember, api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

/**
 * Gerçek salonda yaşanan durum (28.11): salon uygulaması (PWA) pilotu ve WhatsApp kapalı bir işletmede
 * müşteri online randevu aldı, işletmeye hiçbir bildirim gitmedi; müşteri iptal bağlantısını kaybetti,
 * yeniden kayıt olunca mükerrer müşteri oluştu.
 */
describe("Online randevu: işletmeye bildirim, müşteri eşleştirme, iptal bağlantısı", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let slug: string;
  let queue: NotificationQueue;
  const http = () => request(app.getHttpServer());
  const run = (id: string, attemptsMade = 0) => queue.process({ data: { notificationId: id }, attemptsMade } as never);

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Gercek Salon", email: "sahip@salon.test" });
    slug = A.tenant.slug;
    app = await createApp();
    queue = app.get(NotificationQueue);
    a = api(app, await login(app, "sahip@salon.test"), A.tenant.id);
    s = await setupSalon(a, { duration: 60, price: 500 });
    await addMember(app, a, { email: "resepsiyon@salon.test", fullName: "Resepsiyon Kişi", role: "RECEPTION" });
    // Varsayılan durum: PWA bayrakları yok, WhatsApp bağlı değil.
    expect(await su.tenantPwaSettings.count({ where: { tenantId: A.tenant.id } })).toBe(0);
    expect(await su.channelConnection.count({ where: { tenantId: A.tenant.id } })).toBe(0);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("telefon biçimleri tek biçime iner", () => {
    for (const v of ["0532 111 22 33", "+90 532 111 22 33", "905321112233", "5321112233", "(0532) 111-22-33", "0090 532 111 22 33"]) {
      expect(canonicalPhone(v)).toBe("05321112233");
      expect(phoneVariants(v)).toEqual(expect.arrayContaining(["05321112233", "+905321112233", "905321112233", "5321112233"]));
    }
    expect(canonicalPhone("+49 151 1234 5678")).toBe("+4915112345678");
  });

  let bookingId: string;
  let cancelToken: string;
  it("panelde 0532… olarak kayıtlı müşteri, online formda +90 ile yazınca eşleşir (yeni kayıt açılmaz)", async () => {
    // Eski kayıt (normalleştirme öncesi) +90 biçiminde saklanmış olsun.
    const old = await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Zeynep", lastName: "Kaya", phone: "+905321112233" } });
    const before = await su.customer.count({ where: { tenantId: A.tenant.id } });
    const r = await http()
      .post(`/public/salons/${slug}/bookings`)
      .send({ serviceId: s.service.id, startsAt: futureAt(6, "11:00"), firstName: "Zeynep", lastName: "Kaya", phone: "0532 111 22 33", email: "zeynep@musteri.test", kvkkConsent: true })
      .expect(201);
    expect(await su.customer.count({ where: { tenantId: A.tenant.id } })).toBe(before);
    const appt = await su.appointment.findUniqueOrThrow({ where: { id: r.body.bookingId } });
    expect(appt.customerId).toBe(old.id);
    // WhatsApp bağlı değil: ekranda WhatsApp onayı vaat edilmez; e-posta verildi.
    expect(r.body.confirmation).toEqual({ whatsapp: false, email: true });
    bookingId = r.body.bookingId;
    cancelToken = r.body.cancelToken;
  });

  it("işletme sahibi ve resepsiyon e-posta + panel bildirimi alır (PWA ve WhatsApp kapalıyken)", async () => {
    const mails = await su.notification.findMany({ where: { appointmentId: bookingId, channel: "EMAIL", template: "eposta_isletme_yeni_randevu" } });
    expect(mails.map((m) => m.recipient).sort()).toEqual(["resepsiyon@salon.test", "sahip@salon.test"]);
    for (const m of mails) expect(await run(m.id)).toBe("sent");
    const out = await su.outboundEmail.findFirstOrThrow({ where: { to: "sahip@salon.test", template: "booking_new_staff" } });
    expect(out.status).toBe("SENT");
    expect(out.body).toContain("Zeynep Kaya");
    expect(out.body).toContain("05321112233");
    expect(out.body).toMatch(new RegExp(`/panel/takvim\\?tarih=\\d{4}-\\d{2}-\\d{2}&randevu=${bookingId}`));
    // Müşteri adı/telefonu e-posta kaydının değişkenlerinde saklanmaz.
    expect(out.payload).toBeNull();

    const inApp = await a.get("/pwa/notifications?unread=1").expect(200);
    expect(inApp.body.unread).toBeGreaterThanOrEqual(1);
    expect(inApp.body.items[0]).toMatchObject({ type: "appointment.new", title: "Yeni online randevu" });
  });

  it("e-posta bildirimi hiçbir zaman WhatsApp yoluna düşmez", async () => {
    const mock = app.get(MockWhatsAppProvider);
    const sentBefore = mock.outbox.length;
    const n = await su.notification.create({ data: { tenantId: A.tenant.id, channel: "EMAIL", recipient: "x@y.test", template: "bilinmeyen", payload: {} } });
    expect(await run(n.id)).toBe("skipped");
    expect(mock.outbox.length).toBe(sentBefore);
  });

  it("müşteri onay e-postası iptal bağlantısını içerir; bağlantıyla randevu görülür", async () => {
    const n = await su.notification.findFirstOrThrow({ where: { appointmentId: bookingId, template: "eposta_musteri_randevu_onay" } });
    expect(n.recipient).toBe("zeynep@musteri.test");
    expect(await run(n.id)).toBe("sent");
    const out = await su.outboundEmail.findFirstOrThrow({ where: { to: "zeynep@musteri.test", template: "booking_confirmation_customer" } });
    expect(out.body).toContain(`/r/${slug}/iptal?id=${bookingId}&t=${encodeURIComponent(cancelToken)}`);

    const d = await http().get(`/public/salons/${slug}/bookings/${bookingId}?token=${encodeURIComponent(cancelToken)}`).expect(200);
    expect(d.body).toMatchObject({ service: "Lazer Epilasyon", status: "BOOKED", cancellable: true });
    expect(JSON.stringify(d.body)).not.toMatch(/Zeynep|0532/);
    await http().get(`/public/salons/${slug}/bookings/${bookingId}?token=yanlis-belirtec-123`).expect(403);
  });

  it("müşteri iptal edince işletmeye iptal e-postası ve panel bildirimi gider; bekleyen onay e-postası gönderilmez", async () => {
    // İptalden önce kuyruğa alınmış ama gönderilmemiş bir yeni randevu e-postası
    const pending = await su.notification.create({
      data: { tenantId: A.tenant.id, channel: "EMAIL", recipient: "sahip@salon.test", template: "eposta_isletme_yeni_randevu", appointmentId: bookingId, payload: { email: { name: "owner_notice", vars: { subject: "x", body: "y" } } } },
    });
    await http().post(`/public/salons/${slug}/bookings/${bookingId}/cancel`).send({ token: cancelToken }).expect(200);
    expect((await su.notification.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("SKIPPED");
    const mails = await su.notification.findMany({ where: { appointmentId: bookingId, template: "eposta_isletme_musteri_iptal" } });
    expect(mails.map((m) => m.recipient).sort()).toEqual(["resepsiyon@salon.test", "sahip@salon.test"]);
    for (const m of mails) expect(await run(m.id)).toBe("sent");
    const inApp = await a.get("/pwa/notifications?unread=1").expect(200);
    expect(inApp.body.items.some((x: any) => x.type === "appointment.customer_cancelled")).toBe(true);
  });

  it("tercihten 'yeni randevular' kapatılan kullanıcı e-posta almaz", async () => {
    await a.patch("/pwa/preferences").send({ newAppointments: false }).expect(200);
    const r = await http()
      .post(`/public/salons/${slug}/bookings`)
      .send({ serviceId: s.service.id, startsAt: futureAt(6, "14:00"), firstName: "Ali", lastName: "Veli", phone: "05441112233", kvkkConsent: true })
      .expect(201);
    const mails = await su.notification.findMany({ where: { appointmentId: r.body.bookingId, channel: "EMAIL" } });
    expect(mails.map((m) => m.recipient)).toEqual(["resepsiyon@salon.test"]);
    expect(r.body.confirmation).toEqual({ whatsapp: false, email: false });
    await a.patch("/pwa/preferences").send({ newAppointments: true }).expect(200);
  });

  it("telefon eşleşmeyip ad soyad aynıysa yeni kayıt açılır ama randevu notunda olası mükerrer yazılır", async () => {
    const r = await http()
      .post(`/public/salons/${slug}/bookings`)
      .send({ serviceId: s.service.id, startsAt: futureAt(7, "10:00"), firstName: "zeynep", lastName: "KAYA", phone: "05559990011", kvkkConsent: true })
      .expect(201);
    const appt = await su.appointment.findUniqueOrThrow({ where: { id: r.body.bookingId } });
    expect(appt.notes).toMatch(/Olası mükerrer kayıt: .*\(Zeynep Kaya\)/);
    expect(appt.notes).not.toMatch(/532/);
  });

  it("başkasının telefonuyla randevu alan ziyaretçiye giden onay e-postası kayıttaki kişinin adını göstermez", async () => {
    const r = await http()
      .post(`/public/salons/${slug}/bookings`)
      .send({ serviceId: s.service.id, startsAt: futureAt(8, "10:00"), firstName: "Başka", lastName: "Biri", phone: "+90 532 111 22 33", email: "baska@ziyaretci.test", kvkkConsent: true })
      .expect(201);
    const n = await su.notification.findFirstOrThrow({ where: { appointmentId: r.body.bookingId, template: "eposta_musteri_randevu_onay" } });
    expect(n.recipient).toBe("baska@ziyaretci.test");
    expect(await run(n.id)).toBe("sent");
    const out = await su.outboundEmail.findFirstOrThrow({ where: { to: "baska@ziyaretci.test" } });
    expect(out.body).toContain("Merhaba Başka");
    expect(out.body).not.toContain("Zeynep");
  });

  it("eski mükerrer çiftte (aynı numara iki yazımla) kayıt düzenlenebilir; numara yazımı korunur", async () => {
    const x = await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Eski", lastName: "Kayit", phone: "+905367778899" } });
    await su.customer.create({ data: { tenantId: A.tenant.id, firstName: "Eski", lastName: "Kayit2", phone: "05367778899" } });
    const r = await a.patch(`/customers/${x.id}`).send({ firstName: "Eski", lastName: "Düzeltildi", phone: "+90 536 777 88 99" }).expect(200);
    expect(r.body).toMatchObject({ lastName: "Düzeltildi", phone: "+905367778899" });
  });

  it("panelde aynı numara farklı yazımla ikinci kez eklenemez; yeni kayıtlar tek biçimde saklanır", async () => {
    await a.post("/customers").send({ firstName: "Başka", lastName: "Kişi", phone: "0 532 111 22 33" }).expect(409);
    const c = (await a.post("/customers").send({ firstName: "Yeni", lastName: "Kişi", phone: "+90 (535) 222 33 44" }).expect(201)).body;
    expect(c.phone).toBe("05352223344");
    const found = await a.get(`/customers?search=${encodeURIComponent("+90 535 222 33 44")}`).expect(200);
    expect(found.body.items.map((x: any) => x.id)).toContain(c.id);
  });

  it("panel bildirim kanalları özeti: WhatsApp bağlı değil, e-posta ve panel bildirimi açık", async () => {
    const r = await a.get("/pwa/alert-channels").expect(200);
    expect(r.body).toMatchObject({ inApp: true, whatsapp: { connected: false }, email: { to: "sahip@salon.test" }, push: { available: false } });
  });
});
