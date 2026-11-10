import { INestApplication } from "@nestjs/common";
import { addMember, ALL_WEEK, api, createApp, createTenantWithUser, login, owner, resetDb } from "./helpers";

describe("Başlangıç sihirbazı durumu", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let m: ReturnType<typeof api>;
  let s: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Yeni Salon", email: "oa@test.local" });
    await createTenantWithUser(su, { name: "Hazır Salon", email: "ob@test.local" });
    app = await createApp();
    a = api(app, await login(app, "oa@test.local"), A.tenant.id);
    await addMember(app, a, { email: "om@test.local", fullName: "Yönetici", role: "MANAGER" });
    await addMember(app, a, { email: "os@test.local", fullName: "Personel", role: "STAFF" });
    m = api(app, await login(app, "om@test.local"), A.tenant.id);
    s = api(app, await login(app, "os@test.local"), A.tenant.id);
    const B = await su.tenant.findFirstOrThrow({ where: { name: "Hazır Salon" } });
    b = api(app, await login(app, "ob@test.local"), B.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("yeni işletmede hiçbir adım tamamlanmamış görünür", async () => {
    const r = await a.get("/onboarding").expect(200);
    expect(r.body).toMatchObject({ steps: { salon: false, services: false, staff: false, online: false }, done: 0, total: 4, complete: false, dismissed: false, slug: A.tenant.slug });
  });

  it("adımlar mevcut verilerden hesaplanır; panelin başka yerinden yapılan kurulum da sayılır", async () => {
    await a.patch("/settings").send({ phone: "05551234567", address: "Bağdat Cad. 1, Kadıköy" }).expect(200);
    expect((await a.get("/onboarding")).body.steps).toMatchObject({ salon: true, services: false });
    const svc = (await a.post("/services").send({ name: "Fön", durationMin: 30, price: 300 }).expect(201)).body;
    expect((await a.get("/onboarding")).body.steps).toMatchObject({ services: true, staff: false, online: false });
    // Saatsiz ve hizmetsiz personel henüz randevu alamaz.
    const st = (await a.post("/staff").send({ displayName: "Elif" }).expect(201)).body;
    expect((await a.get("/onboarding")).body.steps.staff).toBe(false);
    await a.put(`/staff/${st.id}/services`).send({ serviceIds: [svc.id] }).expect(200);
    await a.put(`/staff/${st.id}/working-hours`).send({ hours: ALL_WEEK }).expect(200);
    const r = await a.get("/onboarding").expect(200);
    expect(r.body).toMatchObject({ steps: { salon: true, services: true, staff: true, online: true }, done: 4, complete: true });
    await a.patch("/settings").send({ onlineBookingEnabled: false }).expect(200);
    expect((await a.get("/onboarding")).body.steps.online).toBe(false);
    await a.patch("/settings").send({ onlineBookingEnabled: true }).expect(200);
  });

  it("yalnız işletme sahibi gizler; yönetici görür; personel göremez", async () => {
    await m.get("/onboarding").expect(200);
    await m.patch("/onboarding").send({ dismissed: true }).expect(403);
    await s.get("/onboarding").expect(403);
    expect((await a.patch("/onboarding").send({ dismissed: true }).expect(200)).body.dismissed).toBe(true);
    expect((await a.patch("/onboarding").send({ dismissed: false }).expect(200)).body.dismissed).toBe(false);
  });

  it("her işletme yalnızca kendi durumunu görür", async () => {
    const r = await b.get("/onboarding").expect(200);
    expect(r.body).toMatchObject({ done: 0, steps: { services: false } });
  });
});
