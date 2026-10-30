import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon, addMember, TEST_PASSWORD } from "./helpers";

describe("Kalite turu: parola değişimi, izin aralığı, bütünlük korumaları", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    app = await createApp();
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    b = api(app, await login(app, "b@test.local"), B.tenant.id);
    s = await setupSalon(a);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("parola değişimi zorunlu kullanıcı (CLI ile açılan hesap) parolasını değiştirmeden işlem yapamaz", async () => {
    const bcrypt = await import("bcryptjs");
    const temp = "GeciciParola2026";
    const u = await su.user.create({ data: { email: "yeni@test.local", fullName: "Yeni Personel", passwordHash: await bcrypt.hash(temp, 4), mustChangePassword: true, emailVerifiedAt: new Date() } });
    await su.membership.create({ data: { tenantId: A.tenant.id, userId: u.id, role: "STAFF" } });
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email: "yeni@test.local", password: temp }).expect(200);
    const n = api(app, res.body.accessToken, A.tenant.id);
    const me = await n.get("/auth/me").expect(200);
    expect(me.body.mustChangePassword).toBe(true);
    const blocked = await n.get("/customers").expect(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");
    await n.post("/auth/change-password").send({ currentPassword: "yanlis", newPassword: "YeniParola2026" }).expect(401);
    await n.post("/auth/change-password").send({ currentPassword: temp, newPassword: "kisa" }).expect(400);
    await n.post("/auth/change-password").send({ currentPassword: temp, newPassword: "YeniParola2026" }).expect(200);
    await n.get("/customers").expect(200);
    await request(app.getHttpServer()).post("/auth/login").send({ email: "yeni@test.local", password: temp }).expect(401);
    await login(app, "yeni@test.local", "YeniParola2026");
  });

  it("izin aralığı listesi yalnızca kendi işletmesini döner", async () => {
    await a.post(`/staff/${s.staff.id}/time-off`).send({ startsAt: futureAt(3, "12:00"), endsAt: futureAt(3, "14:00"), reason: "Eğitim" }).expect(201);
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const r = await a.get(`/time-off?from=${from}&to=${to}`).expect(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ reason: "Eğitim", staff: { displayName: "Elif" } });
    expect((await b.get(`/time-off?from=${from}&to=${to}`).expect(200)).body).toEqual([]);
  });

  it("bekleyen randevusu olan personel pasife alınamaz", async () => {
    const appt = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff2.id, serviceId: s.service.id, startsAt: futureAt(4, "10:00") }).expect(201)).body;
    const r = await a.patch(`/staff/${s.staff2.id}`).send({ isActive: false }).expect(409);
    expect(r.body.message).toMatch(/1 bekleyen randevu/);
    await a.patch(`/appointments/${appt.id}`).send({ staffId: s.staff.id }).expect(200);
    await a.patch(`/staff/${s.staff2.id}`).send({ isActive: false }).expect(200);
  });

  it("randevu fiyatını yalnızca sahip/yönetici değiştirir; erteleme denetim kaydına yazılır", async () => {
    const appt = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(5, "10:00") }).expect(201)).body;
    const r = await a.patch(`/appointments/${appt.id}`).send({ price: 750, startsAt: futureAt(5, "11:00") }).expect(200);
    expect(r.body.price).toBe("750");
    await addMember(app, a, { email: "r@test.local", fullName: "Resepsiyon", role: "RECEPTION" });
    const t1 = await login(app, "r@test.local", TEST_PASSWORD);
    const rec = api(app, t1, A.tenant.id);
    await rec.patch(`/appointments/${appt.id}`).send({ price: 1 }).expect(403);
    const logs = await su.auditLog.count({ where: { entityId: appt.id, action: "appointment.rescheduled" } });
    expect(logs).toBe(1);
  });

  it("anonimleştirme bekleyen randevuları iptal eder ve bildirimleri durdurur", async () => {
    const c = (await a.post("/customers").send({ firstName: "Silinecek", lastName: "Kişi", phone: "05551230000" }).expect(201)).body;
    const appt = (await a.post("/appointments").send({ customerId: c.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(6, "10:00") }).expect(201)).body;
    await a.post(`/customers/${c.id}/anonymize`).expect(201);
    expect((await su.appointment.findUniqueOrThrow({ where: { id: appt.id } })).status).toBe("CANCELLED");
    const queued = await su.notification.count({ where: { appointmentId: appt.id, status: "QUEUED" } });
    expect(queued).toBe(0);
  });

  it("kasa listesi gelir kaydında iade edilen ve kalan tutarı gösterir", async () => {
    const pay = (await a.post("/finance/payments").send({ customerId: s.customer.id, amount: 500, method: "CASH" }).expect(201)).body;
    await a.post(`/finance/transactions/${pay.id}/refund`).send({ amount: 200, reason: "Kısmi iade" }).expect(201);
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 86_400_000).toISOString();
    const list = await a.get(`/finance/transactions?from=${from}&to=${to}`).expect(200);
    expect(list.body.find((x: any) => x.id === pay.id)).toMatchObject({ refundedAmount: "200.00", refundable: "300.00" });
  });

  it("kategori adı tekrarında 409, kullanılan kategori silinemez", async () => {
    const cat = (await a.post("/service-categories").send({ name: "Saç" }).expect(201)).body;
    await a.post("/service-categories").send({ name: "Saç" }).expect(409);
    await a.post("/services").send({ name: "Fön", durationMin: 30, price: 200, categoryId: cat.id }).expect(201);
    await a.delete(`/service-categories/${cat.id}`).expect(409);
    await b.delete(`/service-categories/${cat.id}`).expect(404);
    await a.patch(`/service-categories/${cat.id}`).send({ name: "Saç Bakımı" }).expect(200);
  });
});
