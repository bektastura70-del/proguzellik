import { INestApplication } from "@nestjs/common";
import { addMember, api, createApp, createTenantWithUser, futureAt, login, owner, resetDb, setupSalon } from "./helpers";
import { enablePwa, portal, portalLogin } from "./portal-helpers";

describe("PWA paket ve kalan seans takibi (Modül 5)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let s: Awaited<ReturnType<typeof setupSalon>>;
  let sb: Awaited<ReturnType<typeof setupSalon>>;
  let customerId: string;
  let pkgId: string;
  let tokenA: string;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Paket A", email: "pka@test.local" });
    B = await createTenantWithUser(su, { name: "Paket B", email: "pkb@test.local" });
    app = await createApp();
    a = api(app, await login(app, "pka@test.local"), A.tenant.id);
    b = api(app, await login(app, "pkb@test.local"), B.tenant.id);
    s = await setupSalon(a, { duration: 60 });
    sb = await setupSalon(b, { duration: 60 });
    await enablePwa(su, A.tenant.id);
    await enablePwa(su, B.tenant.id);
    // Aynı kişi iki salonda da müşteri (aynı e-posta)
    customerId = (await a.post("/customers").send({ firstName: "Seans", lastName: "Müşteri", phone: "05441112233", email: "seans@test.local" }).expect(201)).body.id;
    const cB = (await b.post("/customers").send({ firstName: "Seans", lastName: "Müşteri", phone: "05441112233", email: "seans@test.local" }).expect(201)).body.id;
    const tpl = (await a.post("/package-templates").send({ name: "Lazer 8 seans", serviceId: s.service.id, sessionCount: 8, price: 4000, validityDays: 180 }).expect(201)).body;
    pkgId = (await a.post("/customer-packages").send({ customerId, templateId: tpl.id }).expect(201)).body.id;
    const tplB = (await b.post("/package-templates").send({ name: "B Gizli Paket", serviceId: sb.service.id, sessionCount: 4, price: 100 }).expect(201)).body;
    await b.post("/customer-packages").send({ customerId: cB, templateId: tplB.id }).expect(201);
    tokenA = await portalLogin(app, A.tenant.slug, "seans@test.local");
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("müşteri paket adı, toplam/kullanılan/kalan seans ve son kullanım tarihini görür; başka salonun paketi görünmez", async () => {
    const r = await portal(app, A.tenant.slug, tokenA).get("/packages").expect(200);
    expect(r.body).toHaveLength(1);
    expect(r.body[0]).toMatchObject({ name: "Lazer 8 seans", totalSessions: 8, usedSessions: 0, remainingSessions: 8, status: "ACTIVE", service: "Lazer Epilasyon" });
    expect(r.body[0].expiresAt).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toMatch(/B Gizli|price|4000|customerId/);
  });

  it("tamamlanan paketli randevu 1 seans düşer; eşzamanlı ikinci 'tamamlandı' isteği seansı tekrar düşmez", async () => {
    const appt = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(2, "10:00"), customerPackageId: pkgId }).expect(201)).body;
    const planned = await portal(app, A.tenant.slug, tokenA).get("/packages").expect(200);
    expect(planned.body[0]).toMatchObject({ plannedSessions: 1, usedSessions: 0 });
    const rs = await Promise.all([1, 2, 3].map(() => a.post(`/appointments/${appt.id}/status`).send({ status: "COMPLETED" })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    const pkg = await su.customerPackage.findUniqueOrThrow({ where: { id: pkgId } });
    expect(pkg.usedSessions).toBe(1);
    expect(await su.sessionUsage.count({ where: { customerPackageId: pkgId } })).toBe(1);
    const r = await portal(app, A.tenant.slug, tokenA).get("/packages").expect(200);
    expect(r.body[0]).toMatchObject({ usedSessions: 1, remainingSessions: 7, plannedSessions: 0 });
  });

  it("iptal edilen ve gelinmeyen randevu seans düşmez (mevcut işletme kuralı)", async () => {
    const c1 = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(3, "10:00"), customerPackageId: pkgId }).expect(201)).body;
    const c2 = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(3, "12:00"), customerPackageId: pkgId }).expect(201)).body;
    await a.post(`/appointments/${c1.id}/status`).send({ status: "CANCELLED" }).expect(201);
    await a.post(`/appointments/${c2.id}/status`).send({ status: "NO_SHOW" }).expect(201);
    expect((await su.customerPackage.findUniqueOrThrow({ where: { id: pkgId } })).usedSessions).toBe(1);
  });

  it("portal randevu iptali paketli randevuda seans iade/düşüm yapmaz, rezervasyon serbest kalır", async () => {
    const appt = (await a.post("/appointments").send({ customerId, staffId: s.staff.id, serviceId: s.service.id, startsAt: futureAt(5, "10:00"), customerPackageId: pkgId }).expect(201)).body;
    await portal(app, A.tenant.slug, tokenA).post(`/appointments/${appt.id}/cancel`).expect(200);
    const r = await portal(app, A.tenant.slug, tokenA).get("/packages").expect(200);
    expect(r.body[0]).toMatchObject({ usedSessions: 1, plannedSessions: 0 });
  });

  it("süresi geçen paket 'Süresi doldu' görünür", async () => {
    await su.customerPackage.update({ where: { id: pkgId }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
    const r = await portal(app, A.tenant.slug, tokenA).get("/packages").expect(200);
    expect(r.body[0].status).toBe("EXPIRED");
    await su.customerPackage.update({ where: { id: pkgId }, data: { expiresAt: new Date(Date.now() + 90 * 86_400_000) } });
  });

  it("e-postası işletme kaydıyla eşleşmeyen kimlik paket göremez", async () => {
    const t = await portalLogin(app, A.tenant.slug, "baskasi@test.local");
    expect((await portal(app, A.tenant.slug, t).get("/packages").expect(200)).body).toEqual([]);
  });

  it("paket takibi bayrağı kapalıysa 404", async () => {
    await su.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { customerSessionTrackingEnabled: false } });
    await portal(app, A.tenant.slug, tokenA).get("/packages").expect(404);
    await su.tenantPwaSettings.update({ where: { tenantId: A.tenant.id }, data: { customerSessionTrackingEnabled: true } });
  });

  it("paket satışı/iptali mevcut yetkilere bağlı: personel satamaz, resepsiyon iptal edemez", async () => {
    await addMember(app, a, { email: "pk.staff@test.local", fullName: "Pk Personel", role: "STAFF" });
    await addMember(app, a, { email: "pk.rec@test.local", fullName: "Pk Resepsiyon", role: "RECEPTION" });
    const st = api(app, await login(app, "pk.staff@test.local"), A.tenant.id);
    const rec = api(app, await login(app, "pk.rec@test.local"), A.tenant.id);
    const tpl = (await a.get("/package-templates").expect(200)).body[0];
    await st.post("/customer-packages").send({ customerId, templateId: tpl.id }).expect(403);
    await rec.post(`/customer-packages/${pkgId}/cancel`).expect(403);
  });
});
