import { INestApplication } from "@nestjs/common";
import { zonedTime } from "../src/common/time";
import { api, createApp, createTenantWithUser, login, owner, resetDb } from "./helpers";

/** 7 gün sonrası (Europe/Istanbul) */
const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTime(day, h * 60 + m, "Europe/Istanbul").toISOString();
};
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 540, endMin: 1080 }));

describe("Hizmetler, personel, çalışma saatleri ve randevular", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let serviceId: string, staffId: string, staff2Id: string, customerId: string;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    app = await createApp();
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    b = api(app, await login(app, "b@test.local"), B.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("kategori, hizmet ve personel tanımlanır", async () => {
    const cat = await a.post("/service-categories").send({ name: "Cilt Bakımı" }).expect(201);
    const svc = await a
      .post("/services")
      .send({ name: "Klasik Cilt Bakımı", durationMin: 60, price: 750, categoryId: cat.body.id })
      .expect(201);
    serviceId = svc.body.id;
    expect(svc.body.price).toBe("750");
    staffId = (await a.post("/staff").send({ displayName: "Elif", commissionRate: 10 }).expect(201)).body.id;
    staff2Id = (await a.post("/staff").send({ displayName: "Merve" }).expect(201)).body.id;
    await a.put(`/staff/${staffId}/services`).send({ serviceIds: [serviceId] }).expect(200);
    await a.put(`/staff/${staff2Id}/services`).send({ serviceIds: [serviceId] }).expect(200);
    await a.put(`/staff/${staffId}/working-hours`).send({ hours: ALL_WEEK }).expect(200);
    await a.put(`/staff/${staff2Id}/working-hours`).send({ hours: ALL_WEEK }).expect(200);
    customerId = (await a.post("/customers").send({ firstName: "Ayşe", lastName: "Test" }).expect(201)).body.id;
  });

  it("çakışan çalışma saatleri ve geçersiz hizmet reddedilir", async () => {
    await a
      .put(`/staff/${staffId}/working-hours`)
      .send({ hours: [{ weekday: 1, startMin: 540, endMin: 700 }, { weekday: 1, startMin: 600, endMin: 800 }] })
      .expect(400);
    await a.post("/services").send({ name: "X", durationMin: 2, price: 10 }).expect(400);
  });

  it("B, A'nın hizmetini personeline atayamaz ve A'nın verisini göremez", async () => {
    const bStaff = (await b.post("/staff").send({ displayName: "B Personel" }).expect(201)).body.id;
    await b.put(`/staff/${bStaff}/services`).send({ serviceIds: [serviceId] }).expect(404);
    expect((await b.get("/services").expect(200)).body).toEqual([]);
    expect((await b.get("/staff").expect(200)).body.map((s: any) => s.id)).toEqual([bStaff]);
    await b.patch(`/staff/${staffId}`).send({ displayName: "x" }).expect(404);
  });

  it("boş saatler listelenir (09:00–18:00, 60 dk, 15 dk adım)", async () => {
    const res = await a.get(`/availability?date=${day}&serviceId=${serviceId}&staffId=${staffId}`).expect(200);
    expect(res.body[0].startsAt).toBe(at("09:00"));
    expect(res.body[res.body.length - 1].startsAt).toBe(at("17:00"));
    expect(res.body).toHaveLength(33);
  });

  let apptId: string;
  it("randevu oluşturulur; fiyat hizmetten gelir, bitiş süreye göre hesaplanır", async () => {
    const res = await a.post("/appointments").send({ customerId, staffId, serviceId, startsAt: at("10:00") }).expect(201);
    apptId = res.body.id;
    expect(res.body.endsAt).toBe(at("11:00"));
    expect(res.body.price).toBe("750");
  });

  it("aynı personel için çakışan randevu 409 döner (veritabanı kısıtı)", async () => {
    await a.post("/appointments").send({ customerId, staffId, serviceId, startsAt: at("10:30") }).expect(409);
    await a.post("/appointments").send({ customerId, staffId: staff2Id, serviceId, startsAt: at("10:30") }).expect(201);
  });

  it("dolu saatler müsaitlikten düşer", async () => {
    const res = await a.get(`/availability?date=${day}&serviceId=${serviceId}&staffId=${staffId}`).expect(200);
    const starts = res.body.map((s: any) => s.startsAt);
    expect(starts).not.toContain(at("10:00"));
    expect(starts).not.toContain(at("09:15"));
    expect(starts).toContain(at("09:00"));
    expect(starts).toContain(at("11:00"));
  });

  it("çalışma saati dışı ve izinli saatlerde randevu reddedilir", async () => {
    await a.post("/appointments").send({ customerId, staffId, serviceId, startsAt: at("17:30") }).expect(400);
    await a.post(`/staff/${staffId}/time-off`).send({ startsAt: at("14:00"), endsAt: at("16:00"), reason: "Doktor" }).expect(201);
    await a.post("/appointments").send({ customerId, staffId, serviceId, startsAt: at("14:30") }).expect(400);
    const res = await a.get(`/availability?date=${day}&serviceId=${serviceId}&staffId=${staffId}`).expect(200);
    expect(res.body.map((s: any) => s.startsAt)).not.toContain(at("14:00"));
  });

  it("OWNER çalışma saati dışına zorla randevu verebilir; RECEPTION veremez", async () => {
    await a
      .post("/appointments")
      .send({ customerId, staffId, serviceId, startsAt: at("18:00"), ignoreSchedule: true })
      .expect(201);
    const inv = await a.post("/team").send({ email: "r@test.local", fullName: "Resepsiyon", role: "RECEPTION" }).expect(201);
    const r = api(app, await login(app, "r@test.local", inv.body.temporaryPassword), A.tenant.id);
    await r.post("/appointments").send({ customerId, staffId, serviceId, startsAt: at("19:00"), ignoreSchedule: true }).expect(403);
    await r.post("/appointments").send({ customerId, staffId, serviceId, startsAt: at("12:00") }).expect(201);
  });

  it("B, A'nın müşterisi/personeli ile randevu oluşturamaz", async () => {
    const bSvc = (await b.post("/services").send({ name: "B Hizmet", durationMin: 30, price: 100 }).expect(201)).body.id;
    await b.post("/appointments").send({ customerId, staffId, serviceId: bSvc, startsAt: at("10:00") }).expect(404);
    await b.post(`/appointments/${apptId}/status`).send({ status: "CANCELLED" }).expect(404);
  });

  it("takvim listesi tarih aralığına göre döner", async () => {
    const res = await a.get(`/appointments?from=${at("00:00")}&to=${at("23:59")}`).expect(200);
    expect(res.body.length).toBe(4);
    expect(res.body[0].customer.firstName).toBe("Ayşe");
  });

  it("durum geçişleri kurala uyar; iptal edilen saat yeniden açılır", async () => {
    await a.post(`/appointments/${apptId}/status`).send({ status: "CANCELLED", reason: "Müşteri iptal etti" }).expect(201);
    await a.post(`/appointments/${apptId}/status`).send({ status: "COMPLETED" }).expect(409);
    await a.post("/appointments").send({ customerId, staffId, serviceId, startsAt: at("10:00") }).expect(201);
  });

  it("randevu ertelenir; çakışma kontrol edilir", async () => {
    const appt = (await a.post("/appointments").send({ customerId, staffId: staff2Id, serviceId, startsAt: at("13:00") }).expect(201)).body;
    await a.patch(`/appointments/${appt.id}`).send({ startsAt: at("10:45") }).expect(409);
    const ok = await a.patch(`/appointments/${appt.id}`).send({ startsAt: at("15:00") }).expect(200);
    expect(ok.body.endsAt).toBe(at("16:00"));
  });

  it("STAFF yalnızca kendine bağlı randevunun durumunu değiştirebilir", async () => {
    const inv = await a.post("/team").send({ email: "elif@test.local", fullName: "Elif", role: "STAFF" }).expect(201);
    const elifUser = await su.user.findUniqueOrThrow({ where: { email: "elif@test.local" } });
    await a.patch(`/staff/${staffId}`).send({ userId: elifUser.id }).expect(200);
    const s = api(app, await login(app, "elif@test.local", inv.body.temporaryPassword), A.tenant.id);
    const mine = await su.appointment.findFirstOrThrow({ where: { staffId, status: "BOOKED" } });
    const other = await su.appointment.findFirstOrThrow({ where: { staffId: staff2Id, status: "BOOKED" } });
    await s.post(`/appointments/${other.id}/status`).send({ status: "COMPLETED" }).expect(403);
    await s.post(`/appointments/${mine.id}/status`).send({ status: "COMPLETED" }).expect(201);
    await s.post("/appointments").send({ customerId, staffId, serviceId, startsAt: at("16:00") }).expect(403);
  });
});
