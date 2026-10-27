import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";

describe("Online rezervasyon (herkese açık)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let slug: string;
  const http = () => request(app.getHttpServer());
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const guest = { firstName: "Online", lastName: "Müşteri", phone: "0555 999 88 77", kvkkConsent: true };

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    slug = A.tenant.slug;
    app = await createApp();
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    s = await setupSalon(a, { duration: 60, price: 600 });
    await a.patch(`/staff/${s.staff2.id}`).send({ onlineBookable: false }).expect(200);
    await a.post("/services").send({ name: "Gizli Hizmet", durationMin: 30, price: 10, onlineBookable: false }).expect(201);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("salon sayfası yalnızca online açık hizmet ve personeli, hassas veri olmadan döner", async () => {
    const r = await http().get(`/public/salons/${slug}`).expect(200);
    expect(r.body.services.map((x: any) => x.name)).toEqual(["Lazer Epilasyon"]);
    expect(r.body.staff.map((x: any) => x.displayName)).toEqual(["Elif"]);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/commissionRate|tenantId|Ayşe|0555000/);
  });

  it("bilinmeyen veya kapalı işletme 404 döner", async () => {
    await http().get("/public/salons/olmayan-salon").expect(404);
    await su.tenant.update({ where: { id: B.tenant.id }, data: { onlineBookingEnabled: false } });
    await http().get(`/public/salons/${B.tenant.slug}`).expect(404);
    await su.tenant.update({ where: { id: B.tenant.id }, data: { onlineBookingEnabled: true, status: "SUSPENDED" } });
    await http().get(`/public/salons/${B.tenant.slug}`).expect(404);
  });

  it("müsait saatler yalnızca online personelden gelir", async () => {
    const r = await http().get(`/public/salons/${slug}/availability?date=${day(5)}&serviceId=${s.service.id}`).expect(200);
    expect(r.body.length).toBe(33);
    expect(new Set(r.body.map((x: any) => x.staffName))).toEqual(new Set(["Elif"]));
    await http().get(`/public/salons/${slug}/availability?date=${day(90)}&serviceId=${s.service.id}`).expect(400);
  });

  let booking: any;
  it("KVKK onaysız rezervasyon reddedilir", async () => {
    await http().post(`/public/salons/${slug}/bookings`).send({ ...guest, kvkkConsent: false, serviceId: s.service.id, startsAt: futureAt(5, "10:00") }).expect(400);
  });

  it("rezervasyon müşteri kaydı oluşturur, personel otomatik atanır", async () => {
    const r = await http().post(`/public/salons/${slug}/bookings`).send({ ...guest, serviceId: s.service.id, startsAt: futureAt(5, "10:00") }).expect(201);
    booking = r.body;
    expect(r.body).toMatchObject({ staff: "Elif", service: "Lazer Epilasyon", price: "600" });
    const c = await su.customer.findFirstOrThrow({ where: { tenantId: A.tenant.id, phone: "05559998877" } });
    expect(c).toMatchObject({ source: "ONLINE", firstName: "Online" });
    expect(c.kvkkConsentAt).toBeTruthy();
    const appt = await su.appointment.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(appt).toMatchObject({ source: "ONLINE", status: "BOOKED", customerId: c.id });
  });

  it("aynı saat ikinci kez alınamaz; mevcut müşteri tekrar oluşturulmaz", async () => {
    await http().post(`/public/salons/${slug}/bookings`).send({ ...guest, serviceId: s.service.id, startsAt: futureAt(5, "10:00") }).expect(409);
    await http().post(`/public/salons/${slug}/bookings`).send({ ...guest, firstName: "Değişik", serviceId: s.service.id, startsAt: futureAt(5, "12:00") }).expect(201);
    expect(await su.customer.count({ where: { tenantId: A.tenant.id, phone: "05559998877" } })).toBe(1);
    const c = await su.customer.findFirstOrThrow({ where: { tenantId: A.tenant.id, phone: "05559998877" } });
    expect(c.firstName).toBe("Online");
  });

  it("online kapalı personel/hizmet ve çalışma saati dışı seçilemez", async () => {
    await http().post(`/public/salons/${slug}/bookings`).send({ ...guest, serviceId: s.service.id, staffId: s.staff2.id, startsAt: futureAt(5, "14:00") }).expect(409);
    await http().post(`/public/salons/${slug}/bookings`).send({ ...guest, serviceId: s.service.id, startsAt: futureAt(5, "20:00") }).expect(409);
    const hidden = await su.service.findFirstOrThrow({ where: { tenantId: A.tenant.id, name: "Gizli Hizmet" } });
    await http().post(`/public/salons/${slug}/bookings`).send({ ...guest, serviceId: hidden.id, startsAt: futureAt(5, "14:00") }).expect(404);
  });

  it("başka işletmenin hizmetiyle rezervasyon yapılamaz", async () => {
    await su.tenant.update({ where: { id: B.tenant.id }, data: { status: "ACTIVE" } });
    await http().post(`/public/salons/${B.tenant.slug}/bookings`).send({ ...guest, serviceId: s.service.id, startsAt: futureAt(5, "14:00") }).expect(404);
  });

  it("geçersiz token ile iptal edilemez; doğru token ile iptal edilir", async () => {
    await http().post(`/public/salons/${slug}/bookings/${booking.bookingId}/cancel`).send({ token: "x".repeat(43) }).expect(403);
    await http().post(`/public/salons/${B.tenant.slug}/bookings/${booking.bookingId}/cancel`).send({ token: booking.cancelToken }).expect(404);
    await http().post(`/public/salons/${slug}/bookings/${booking.bookingId}/cancel`).send({ token: booking.cancelToken }).expect(200);
    const appt = await su.appointment.findUniqueOrThrow({ where: { id: booking.bookingId } });
    expect(appt.status).toBe("CANCELLED");
  });

  it("aynı telefonla günlük rezervasyon sınırı uygulanır", async () => {
    process.env.DISABLE_RATE_LIMIT = "0";
    try {
      const codes: number[] = [];
      for (const hh of ["09:00", "11:00", "13:00", "15:00"]) {
        const r = await http().post(`/public/salons/${slug}/bookings`).send({ ...guest, phone: "05551234567", serviceId: s.service.id, startsAt: futureAt(6, hh) });
        codes.push(r.status);
      }
      expect(codes).toEqual([201, 201, 201, 429]);
    } finally {
      process.env.DISABLE_RATE_LIMIT = "1";
    }
  });
});
