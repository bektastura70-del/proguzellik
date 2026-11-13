import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { loadEnv } from "../src/config/env";
import { api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";
import { enablePwa, lastOtp, portal, portalLogin } from "./portal-helpers";

describe("PWA müşteri portalı (Modül 1)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let sb: Awaited<ReturnType<typeof setupSalon>>;
  const http = () => request(app.getHttpServer());
  const guest = { firstName: "Zeynep", lastName: "Portal", phone: "0532 111 22 33", kvkkConsent: true };
  let token: string;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Portal A", email: "pa@test.local" });
    B = await createTenantWithUser(su, { name: "Portal B", email: "pb@test.local" });
    app = await createApp();
    a = api(app, await login(app, "pa@test.local"), A.tenant.id);
    b = api(app, await login(app, "pb@test.local"), B.tenant.id);
    s = await setupSalon(a, { duration: 60, price: 500 });
    sb = await setupSalon(b, { duration: 60, price: 500 });
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("bayrak kapalıyken portal 404, eski anonim rezervasyon aynen çalışır", async () => {
    const info = await http().get(`/public/salons/${A.tenant.slug}/app`).expect(200);
    expect(info.body.features).toEqual({ installable: false, portal: false, packages: false, push: false });
    await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email: "x@test.local" }).expect(404);
    await portal(app, A.tenant.slug).get("/appointments").expect(404);
    await http().post(`/public/salons/${A.tenant.slug}/bookings`).send({ ...guest, phone: "05320000000", serviceId: s.service.id, startsAt: futureAt(3, "09:00") }).expect(201);
  });

  it("bayrak açılınca uygulama bilgisi hassas veri olmadan döner", async () => {
    await enablePwa(su, A.tenant.id);
    await enablePwa(su, B.tenant.id);
    const info = await http().get(`/public/salons/${A.tenant.slug}/app`).expect(200);
    expect(info.body.features).toMatchObject({ installable: true, portal: true, packages: true });
    expect(info.body.rules).toEqual({ cancelMinHours: 2, rescheduleMinHours: 2, allowCancel: true, allowReschedule: true });
    expect(JSON.stringify(info.body)).not.toMatch(/tenantId|pa@test|phone|commission/);
  });

  it("oturumsuz portal işlemleri 401", async () => {
    const p = portal(app, A.tenant.slug);
    await p.get("/appointments").expect(401);
    await p.get("/me").expect(401);
    await p.post("/bookings").send({ ...guest, serviceId: s.service.id, startsAt: futureAt(5, "10:00") }).expect(401);
    await portal(app, A.tenant.slug, "x".repeat(43)).get("/appointments").expect(401);
  });

  it("doğrulama kodu: hatalı kod reddedilir, 5 hatadan sonra kod geçersizleşir, doğru kod tek kullanımlık", async () => {
    const email = "Zeynep@Test.local";
    await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email }).expect(202);
    const code = lastOtp(app, email)!;
    expect(code).toMatch(/^\d{6}$/);
    // Kod düz metin olarak saklanmaz
    const row = await su.customerOtp.findFirstOrThrow({ where: { tenantId: A.tenant.id, destination: "zeynep@test.local" }, orderBy: { createdAt: "desc" } });
    expect(row.codeHash).not.toContain(code);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await http().post(`/public/salons/${A.tenant.slug}/portal/verify`).send({ email, code: wrong }).expect(401);
    }
    await http().post(`/public/salons/${A.tenant.slug}/portal/verify`).send({ email, code }).expect(401);
    // Yeni kod çalışır, ikinci kez kullanılamaz
    token = await portalLogin(app, A.tenant.slug, email);
    expect(token.length).toBeGreaterThan(30);
    const again = lastOtp(app, email)!;
    await http().post(`/public/salons/${A.tenant.slug}/portal/verify`).send({ email, code: again }).expect(401);
    const me = await portal(app, A.tenant.slug, token).get("/me").expect(200);
    expect(me.body.email).toBe("zeynep@test.local");
    // Oturum belirteci düz saklanmaz
    expect(await su.customerPortalSession.count({ where: { tokenHash: token } })).toBe(0);
  });

  it("A salonunun kodu ve oturumu B salonunda geçmez", async () => {
    await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email: "cross@test.local" }).expect(202);
    const code = lastOtp(app, "cross@test.local")!;
    await http().post(`/public/salons/${B.tenant.slug}/portal/verify`).send({ email: "cross@test.local", code }).expect(401);
    await portal(app, B.tenant.slug, token).get("/appointments").expect(401);
  });

  let bookingId: string;
  it("doğrulanmış müşteri randevu alır; müşteri kaydı doğrulanmış e-postayla oluşur", async () => {
    const r = await portal(app, A.tenant.slug, token).post("/bookings").set("Idempotency-Key", "test-key-0001").send({ ...guest, serviceId: s.service.id, startsAt: futureAt(5, "10:00") }).expect(201);
    bookingId = r.body.bookingId;
    expect(r.body).toMatchObject({ replay: false, staff: "Elif", service: "Lazer Epilasyon", status: "BOOKED" });
    const appt = await su.appointment.findUniqueOrThrow({ where: { id: bookingId }, include: { customer: true } });
    expect(appt.source).toBe("ONLINE");
    expect(appt.customer).toMatchObject({ email: "zeynep@test.local", phone: "05321112233", source: "ONLINE" });
    expect(appt.customer.kvkkConsentAt).toBeTruthy();
    // İşletme sahibi yeni randevuyu panelde görür (kabul kriteri 4)
    const list = await a.get(`/appointments?from=${futureAt(5, "00:00")}&to=${futureAt(6, "00:00")}`).expect(200);
    expect(list.body.map((x: any) => x.id)).toContain(bookingId);
  });

  it("aynı Idempotency-Key ile tekrar gönderim aynı randevuyu döner, yenisini oluşturmaz", async () => {
    const r = await portal(app, A.tenant.slug, token).post("/bookings").set("Idempotency-Key", "test-key-0001").send({ ...guest, serviceId: s.service.id, startsAt: futureAt(5, "10:00") }).expect(201);
    expect(r.body).toMatchObject({ bookingId, replay: true });
    expect(await su.appointment.count({ where: { tenantId: A.tenant.id, portalIdentityId: { not: null } } })).toBe(1);
  });

  it("eşzamanlı aynı anahtarlı istekler tek randevu oluşturur", async () => {
    const send = () => portal(app, A.tenant.slug, token).post("/bookings").set("Idempotency-Key", "test-key-par-01").send({ ...guest, serviceId: s.service.id, startsAt: futureAt(6, "10:00") });
    const rs = await Promise.all([send(), send(), send()]);
    expect(rs.map((r) => r.status).every((c) => c === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.body.bookingId)).size).toBe(1);
  });

  it("aynı personel aynı saate eşzamanlı farklı isteklerle çift randevu alamaz (kabul kriteri 2)", async () => {
    const other = await portalLogin(app, A.tenant.slug, "diger@test.local");
    const at = futureAt(7, "11:00");
    const reqs = [token, other, token, other].map((tk, i) =>
      portal(app, A.tenant.slug, tk).post("/bookings").set("Idempotency-Key", `race-key-000${i}`).send({ ...guest, phone: `053200000${10 + i}`, serviceId: s.service.id, staffId: s.staff.id, startsAt: at }),
    );
    const rs = await Promise.all(reqs);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(3);
    const cnt = await su.appointment.count({ where: { tenantId: A.tenant.id, staffId: s.staff.id, startsAt: new Date(at), status: { in: ["BOOKED", "CONFIRMED"] } } });
    expect(cnt).toBe(1);
  });

  it("geçmiş, çok yakın ve 60 günden ileri saat reddedilir; online kapalı hizmet alınamaz", async () => {
    const p = portal(app, A.tenant.slug, token);
    await p.post("/bookings").send({ ...guest, serviceId: s.service.id, startsAt: new Date(Date.now() - 3_600_000).toISOString() }).expect(400);
    await p.post("/bookings").send({ ...guest, serviceId: s.service.id, startsAt: new Date(Date.now() + 5 * 60_000).toISOString() }).expect(400);
    await p.post("/bookings").send({ ...guest, serviceId: s.service.id, startsAt: futureAt(70, "10:00") }).expect(400);
    const hidden = (await a.post("/services").send({ name: "Gizli", durationMin: 30, price: 10, onlineBookable: false }).expect(201)).body;
    await p.post("/bookings").send({ ...guest, serviceId: hidden.id, startsAt: futureAt(5, "15:00") }).expect(404);
    // B salonunun hizmeti A salonundan alınamaz
    await p.post("/bookings").send({ ...guest, serviceId: sb.service.id, startsAt: futureAt(5, "15:00") }).expect(404);
  });

  it("personel izni ve çalışma saati dışı saat alınamaz", async () => {
    const p = portal(app, A.tenant.slug, token);
    await a.post(`/staff/${s.staff2.id}/time-off`).send({ startsAt: futureAt(8, "09:00"), endsAt: futureAt(8, "18:00"), reason: "İzin" }).expect(201);
    await p.post("/bookings").send({ ...guest, serviceId: s.service.id, staffId: s.staff2.id, startsAt: futureAt(8, "10:00") }).expect(409);
    await p.post("/bookings").send({ ...guest, serviceId: s.service.id, startsAt: futureAt(8, "19:30") }).expect(409);
  });

  it("müşteri yalnızca kendi randevularını görür (kabul kriteri 3)", async () => {
    const mine = await portal(app, A.tenant.slug, token).get("/appointments").expect(200);
    const ids = mine.body.upcoming.map((x: any) => x.id);
    expect(ids).toContain(bookingId);
    const other = await portalLogin(app, A.tenant.slug, "diger@test.local");
    const theirs = await portal(app, A.tenant.slug, other).get("/appointments").expect(200);
    expect(theirs.body.upcoming.map((x: any) => x.id)).not.toContain(bookingId);
    expect(JSON.stringify(mine.body)).not.toMatch(/notes|customerId|phone/);
  });

  it("işletmenin kaydettiği e-posta ile eşleşen eski randevular da görünür; telefonu tutan başka kayıt değiştirilmez", async () => {
    // İşletme kaydı: e-postası işletmede kayıtlı müşteri
    const c = (await a.post("/customers").send({ firstName: "Kayıtlı", lastName: "Müşteri", phone: "05339998877", email: "kayitli@test.local" }).expect(201)).body;
    const appt = (await a.post("/appointments").send({ customerId: c.id, staffId: s.staff2.id, serviceId: s.service.id, startsAt: futureAt(9, "10:00") }).expect(201)).body;
    const tk = await portalLogin(app, A.tenant.slug, "kayitli@test.local");
    const list = await portal(app, A.tenant.slug, tk).get("/appointments").expect(200);
    expect(list.body.upcoming.map((x: any) => x.id)).toContain(appt.id);
    // Başka birinin kayıtlı telefonuyla randevu: kayıt (ad, e-posta, KVKK) değişmez, not düşülür
    const before = await su.customer.findUniqueOrThrow({ where: { id: c.id } });
    const intruder = await portalLogin(app, A.tenant.slug, "baska@test.local");
    const r = await portal(app, A.tenant.slug, intruder).post("/bookings").send({ ...guest, firstName: "Başka", phone: "05339998877", serviceId: s.service.id, startsAt: futureAt(9, "14:00") }).expect(201);
    const after = await su.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toEqual(before);
    const ap = await su.appointment.findUniqueOrThrow({ where: { id: r.body.bookingId } });
    expect(ap.notes).toContain("teyit");
    // Telefon eşleşmesi kayıttaki müşterinin diğer randevularını göstermez
    const seen = await portal(app, A.tenant.slug, intruder).get("/appointments").expect(200);
    expect(seen.body.upcoming.map((x: any) => x.id)).not.toContain(appt.id);
  });

  it("randevu değiştirme: kendi randevusu, müsait saate; eski saat boşalır", async () => {
    const p = portal(app, A.tenant.slug, token);
    const to = futureAt(5, "13:00");
    const r = await p.post(`/appointments/${bookingId}/reschedule`).send({ startsAt: to }).expect(200);
    expect(new Date(r.body.startsAt).toISOString()).toBe(to);
    expect(r.body.status).toBe("BOOKED");
    // aynı randevuyu kendi süresiyle çakışan 1 saat kaydırma (kendisi meşgul sayılmaz)
    await p.post(`/appointments/${bookingId}/reschedule`).send({ startsAt: futureAt(5, "13:30") }).expect(200);
    // dolu saate değiştirilemez
    const busy = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(5, "16:00") }).expect(201)).body;
    await p.post(`/appointments/${bookingId}/reschedule`).send({ startsAt: futureAt(5, "16:00"), staffId: s.staff.id }).expect(409);
    expect(busy.id).toBeTruthy();
    // başkasının randevusu değiştirilemez / iptal edilemez (varlık sızdırılmaz)
    const other = await portalLogin(app, A.tenant.slug, "diger@test.local");
    await portal(app, A.tenant.slug, other).post(`/appointments/${bookingId}/reschedule`).send({ startsAt: futureAt(5, "17:00") }).expect(404);
    await portal(app, A.tenant.slug, other).post(`/appointments/${bookingId}/cancel`).expect(404);
    await portal(app, A.tenant.slug, other).post(`/appointments/${busy.id}/cancel`).expect(404);
  });

  it("işletme kuralları: süre sınırı ve kapalı iptal", async () => {
    const p = portal(app, A.tenant.slug, token);
    await su.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { cancelMinHours: 24 * 7, allowCustomerReschedule: false } });
    await p.post(`/appointments/${bookingId}/cancel`).expect(409);
    await p.post(`/appointments/${bookingId}/reschedule`).send({ startsAt: futureAt(5, "11:00") }).expect(403);
    const list = await p.get("/appointments").expect(200);
    expect(list.body.upcoming.find((x: any) => x.id === bookingId)).toMatchObject({ canCancel: false, canReschedule: false });
    await su.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { cancelMinHours: 2, allowCustomerReschedule: true } });
  });

  it("iptal: kendi randevusu iptal olur, ikinci iptal 409, işletme kaydı denetim izine yazılır", async () => {
    const p = portal(app, A.tenant.slug, token);
    const r = await p.post(`/appointments/${bookingId}/cancel`).expect(200);
    expect(r.body.status).toBe("CANCELLED");
    await p.post(`/appointments/${bookingId}/cancel`).expect(409);
    const logs = await su.auditLog.findMany({ where: { tenantId: A.tenant.id, entityId: bookingId } });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["booking.portal_created", "booking.portal_rescheduled", "booking.portal_cancelled"]));
  });

  it("çıkış yapılan oturum geçersizdir", async () => {
    const tk = await portalLogin(app, A.tenant.slug, "cikis@test.local");
    await portal(app, A.tenant.slug, tk).post("/logout").expect(200);
    await portal(app, A.tenant.slug, tk).get("/me").expect(401);
  });

  it("mağaza inceleme girişi: yalnızca tanımlı işletmede ve adreste sabit kod, e-posta gitmez; varsayılan kapalı", async () => {
    const env = loadEnv();
    const before = { REVIEW_LOGIN_SLUG: env.REVIEW_LOGIN_SLUG, REVIEW_LOGIN_EMAIL: env.REVIEW_LOGIN_EMAIL, REVIEW_LOGIN_CODE: env.REVIEW_LOGIN_CODE };
    const email = "inceleme@test.local";
    // Kapalıyken (tanımsız) sabit kod çalışmaz
    await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email }).expect(202);
    await http().post(`/public/salons/${A.tenant.slug}/portal/verify`).send({ email, code: "246810" }).expect(401);
    Object.assign(env, { REVIEW_LOGIN_SLUG: A.tenant.slug, REVIEW_LOGIN_EMAIL: email, REVIEW_LOGIN_CODE: "246810" });
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MockEmailProvider } = require("../src/email/email.provider");
      const outbox = app.get(MockEmailProvider).outbox as { to: string }[];
      const sentBefore = outbox.filter((m) => m.to === email).length;
      await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email: " Inceleme@Test.local " }).expect(202);
      expect(outbox.filter((m) => m.to === email).length).toBe(sentBefore);
      const ok = await http().post(`/public/salons/${A.tenant.slug}/portal/verify`).send({ email, code: "246810" }).expect(200);
      await portal(app, A.tenant.slug, ok.body.token).get("/me").expect(200);
      // Başka işletmede aynı adres: normal akış (rastgele kod e-postayla), sabit kod geçmez
      await http().post(`/public/salons/${B.tenant.slug}/portal/otp`).send({ email }).expect(202);
      expect(outbox.filter((m) => m.to === email).length).toBe(sentBefore + 1);
      await http().post(`/public/salons/${B.tenant.slug}/portal/verify`).send({ email, code: "246810" }).expect(401);
      // Aynı işletmede başka adres: sabit kod geçmez
      await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email: "baska@test.local" }).expect(202);
      await http().post(`/public/salons/${A.tenant.slug}/portal/verify`).send({ email: "baska@test.local", code: "246810" }).expect(401);
    } finally {
      Object.assign(env, before);
    }
  });

  it("hesap silme: yeni kod ister, yanlış kodla silinmez; doğru kodla kimlik, oturumlar ve abonelikler silinir, salon kaydı kalır", async () => {
    const email = "sil@test.local";
    const tk = await portalLogin(app, A.tenant.slug, email);
    const p = portal(app, A.tenant.slug, tk);
    const r = await p.post("/bookings").set("Idempotency-Key", "silme-testi-0001").send({ ...guest, phone: "0532 999 88 77", serviceId: s.service.id, startsAt: futureAt(6, "15:00") }).expect(201);
    const apptId = r.body.id ?? r.body.appointment?.id;
    const identity = await su.customerIdentity.findFirstOrThrow({ where: { tenantId: A.tenant.id, email } });
    await su.pushSubscription.create({ data: { tenantId: A.tenant.id, audience: "CUSTOMER", identityId: identity.id, endpoint: "https://fcm.googleapis.com/fcm/send/silme", p256dh: "x", auth: "y" } });

    // Oturumsuz silinemez
    await portal(app, A.tenant.slug).post("/me/delete").send({ code: "123456" }).expect(401);
    // Giriş kodu (tüketilmiş) yeniden kullanılamaz; yeni kod gerekir
    await p.post("/me/delete").send({ code: "000000" }).expect(401);
    await http().post(`/public/salons/${A.tenant.slug}/portal/otp`).send({ email }).expect(202);
    const code = lastOtp(app, email)!;
    const wrong = code === "111111" ? "222222" : "111111";
    await p.post("/me/delete").send({ code: wrong }).expect(401);
    expect(await su.customerIdentity.count({ where: { id: identity.id } })).toBe(1);
    // Başka salonun oturumu bu salonda silemez
    await portal(app, B.tenant.slug, tk).post("/me/delete").send({ code }).expect(401);

    await p.post("/me/delete").send({ code }).expect(200);
    expect(await su.customerIdentity.count({ where: { id: identity.id } })).toBe(0);
    expect(await su.customerPortalSession.count({ where: { identityId: identity.id } })).toBe(0);
    expect(await su.pushSubscription.count({ where: { identityId: identity.id } })).toBe(0);
    expect(await su.customerOtp.count({ where: { tenantId: A.tenant.id, destination: email } })).toBe(0);
    if (apptId) {
      const appt = await su.appointment.findUniqueOrThrow({ where: { id: apptId } });
      expect(appt.portalIdentityId).toBeNull();
    }
    expect(await su.appointment.count({ where: { tenantId: A.tenant.id, customer: { phone: { contains: "999" } } } })).toBeGreaterThan(0);
    expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: "portal.identity_deleted", entityId: identity.id } })).toBe(1);
    await p.get("/me").expect(401);
    // Aynı e-postayla yeniden giriş yeni (boş) bir hesap açar
    const tk2 = await portalLogin(app, A.tenant.slug, email);
    await portal(app, A.tenant.slug, tk2).get("/me").expect(200);
  });

  it("işletme askıya alınınca portal kapanır", async () => {
    await su.tenant.update({ where: { id: B.tenant.id }, data: { status: "SUSPENDED" } });
    await http().get(`/public/salons/${B.tenant.slug}/app`).expect(404);
    await http().post(`/public/salons/${B.tenant.slug}/portal/otp`).send({ email: "x@test.local" }).expect(404);
    await su.tenant.update({ where: { id: B.tenant.id }, data: { status: "ACTIVE" } });
  });
});
