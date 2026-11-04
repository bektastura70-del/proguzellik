import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { addMember, api, createApp, createTenantWithUser, enableMfa, futureAt, login, owner, resetDb, setupSalon, TEST_PASSWORD } from "./helpers";
import { enablePwa } from "./portal-helpers";

describe("PWA işletme ve personel mobil paneli (Modül 2) + SaaS sahibi bayrakları", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let staff: ReturnType<typeof api>;
  let rec: ReturnType<typeof api>;
  let admin: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let elifUserId: string;
  const day = () => futureAt(3, "00:00");
  const dateStr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(futureAt(3, "12:00")));

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Mobil A", email: "ma@test.local" });
    B = await createTenantWithUser(su, { name: "Mobil B", email: "mb@test.local" });
    await su.user.create({ data: { email: "padmin@proguzellik.test", fullName: "Platform", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true } });
    app = await createApp();
    a = api(app, await login(app, "ma@test.local"), A.tenant.id);
    s = await setupSalon(a, { duration: 60 });
    await addMember(app, a, { email: "elif.p@test.local", fullName: "Elif P", role: "STAFF" });
    await addMember(app, a, { email: "rec.p@test.local", fullName: "Resepsiyon P", role: "RECEPTION" });
    elifUserId = (await su.user.findUniqueOrThrow({ where: { email: "elif.p@test.local" } })).id;
    await a.patch(`/staff/${s.staff.id}`).send({ userId: elifUserId }).expect(200);
    staff = api(app, await login(app, "elif.p@test.local"), A.tenant.id);
    rec = api(app, await login(app, "rec.p@test.local"), A.tenant.id);
    admin = api(app, (await enableMfa(app, "padmin@proguzellik.test")).token);
    void day;
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("bayrak kapalıyken mobil uç noktalar 404; bayraklar okunabilir ve kapalı", async () => {
    const f = await a.get("/pwa/flags").expect(200);
    expect(f.body).toMatchObject({ businessPwaEnabled: false, customerBookingEnabled: false, pushAvailable: false });
    await a.get(`/pwa/agenda?date=${dateStr()}`).expect(404);
    await a.get("/pwa/pending").expect(404);
  });

  it("bayrakları yalnızca SaaS sahibi değiştirir; neden zorunlu; denetim izine yazılır", async () => {
    await a.patch(`/platform/tenants/${A.tenant.id}/pwa`).send({ businessPwaEnabled: true, reason: "pilot" }).expect(403);
    await admin.patch(`/platform/tenants/${A.tenant.id}/pwa`).send({ businessPwaEnabled: true }).expect(400);
    const r = await admin.patch(`/platform/tenants/${A.tenant.id}/pwa`).send({ businessPwaEnabled: true, reason: "Yerel pilot testi" }).expect(200);
    expect(r.body.flags.businessPwaEnabled).toBe(true);
    expect(r.body.flags.customerBookingEnabled).toBe(false);
    expect(r.body.keys.businessPwaEnabled).toBe("business_pwa_enabled");
    const log = await su.auditLog.findFirstOrThrow({ where: { action: "platform.pwa_flags_changed", tenantId: A.tenant.id } });
    expect(log.metadata).toMatchObject({ reason: "Yerel pilot testi", change: { businessPwaEnabled: true } });
    // B işletmesi etkilenmez
    expect((await su.tenantPwaSettings.findUnique({ where: { tenantId: B.tenant.id } }))).toBeNull();
  });

  it("işletme rolü bayrak sütunlarını veritabanında da değiştiremez (sütun yetkisi)", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const appDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
    await expect(
      appDb.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${A.tenant.id}, true)`;
        await tx.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { customerBookingEnabled: true } });
      }),
    ).rejects.toThrow(/permission denied/);
    await appDb.$disconnect();
  });

  it("personel günlük planında yalnızca kendi randevuları; masa rolleri hepsini görür", async () => {
    const mine = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(3, "10:00") }).expect(201)).body;
    const other = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff2.id, serviceId: s.service.id, startsAt: futureAt(3, "10:00") }).expect(201)).body;
    const st = await staff.get(`/pwa/agenda?date=${dateStr()}`).expect(200);
    expect(st.body.own).toBe(true);
    expect(st.body.items.map((x: any) => x.id)).toEqual([mine.id]);
    expect(st.body.items[0]).toMatchObject({ mine: true, canChangeStatus: true });
    expect(st.body.items[0].customer.phone).toBeTruthy();
    // staffId parametresiyle başkasının planı istenemez
    const forced = await staff.get(`/pwa/agenda?date=${dateStr()}&staffId=${s.staff2.id}`).expect(200);
    expect(forced.body.items.map((x: any) => x.id)).toEqual([mine.id]);
    const desk = await rec.get(`/pwa/agenda?date=${dateStr()}`).expect(200);
    expect(desk.body.items.map((x: any) => x.id).sort()).toEqual([mine.id, other.id].sort());
    // Personel başkasının randevusunun durumunu değiştiremez (mevcut kural korunur)
    await staff.post(`/appointments/${other.id}/status`).send({ status: "CONFIRMED" }).expect(403);
    await staff.post(`/appointments/${mine.id}/status`).send({ status: "CONFIRMED" }).expect(201);
  });

  it("personel finans, rapor ve yönetim uçlarına erişemez", async () => {
    await staff.get("/finance/transactions").expect(403);
    await staff.get("/reports/summary").expect((r) => expect([403, 404]).toContain(r.status));
    await staff.post("/services").send({ name: "X", durationMin: 30, price: 1 }).expect(403);
    await staff.get("/team").expect(403);
  });

  it("onay bekleyenler: masa rolü tümünü, personel yalnız kendininkini görür", async () => {
    const p = (await a.post("/appointments").send({ customerId: s.customer.id, staffId: s.staff2.id, serviceId: s.service.id, startsAt: futureAt(4, "11:00") }).expect(201)).body;
    const desk = await a.get("/pwa/pending").expect(200);
    expect(desk.body.map((x: any) => x.id)).toContain(p.id);
    const st = await staff.get("/pwa/pending").expect(200);
    expect(st.body.map((x: any) => x.id)).not.toContain(p.id);
  });

  it("bildirim merkezi yalnız kullanıcının kendi kayıtlarını gösterir ve okundu işaretler", async () => {
    const ownerId = A.user.id;
    await su.inAppNotification.createMany({
      data: [
        { tenantId: A.tenant.id, audience: "STAFF", userId: elifUserId, type: "appointment.assigned", title: "Size randevu atandı", body: "5 Kasım 10:00", dedupeKey: "t1" },
        { tenantId: A.tenant.id, audience: "STAFF", userId: ownerId, type: "appointment.created", title: "Yeni randevu", body: "5 Kasım 10:00", dedupeKey: "t2" },
        { tenantId: B.tenant.id, audience: "STAFF", userId: B.user.id, type: "appointment.created", title: "B", body: "B", dedupeKey: "t3" },
      ],
    });
    const el = await staff.get("/pwa/notifications").expect(200);
    expect(el.body.items.map((x: any) => x.title)).toEqual(["Size randevu atandı"]);
    expect(el.body.unread).toBe(1);
    const ownerRow = await su.inAppNotification.findFirstOrThrow({ where: { dedupeKey: "t2" } });
    await staff.post(`/pwa/notifications/${ownerRow.id}/read`).expect(404);
    await staff.post("/pwa/notifications/read-all").expect(200);
    expect((await staff.get("/pwa/notifications").expect(200)).body.unread).toBe(0);
    expect((await su.inAppNotification.findFirstOrThrow({ where: { dedupeKey: "t2" } })).readAt).toBeNull();
  });

  it("bildirim tercihleri kişiye özel; personel 'tüm yeni randevular' tercihini açamaz", async () => {
    await staff.patch("/pwa/preferences").send({ newAppointments: true }).expect(403);
    const r = await staff.patch("/pwa/preferences").send({ cancellations: false }).expect(200);
    expect(r.body.cancellations).toBe(false);
    expect((await a.get("/pwa/preferences").expect(200)).body.cancellations).toBe(true);
  });

  it("enablePwa yardımcısıyla açılan diğer işletme bayrakları birbirine karışmaz", async () => {
    await enablePwa(su, B.tenant.id, { businessPwaEnabled: false });
    const bApi = api(app, await login(app, "mb@test.local"), B.tenant.id);
    await bApi.get(`/pwa/agenda?date=${dateStr()}`).expect(404);
  });
});
