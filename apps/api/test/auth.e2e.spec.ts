import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { api, createApp, createTenantWithUser, login, owner, resetDb, TEST_PASSWORD, addMember, registerTrial } from "./helpers";

describe("Giriş, kayıt, roller ve işletme erişimi (API)", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("/health oturumsuz çalışır", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("oturumsuz korumalı uç noktalar 401 döner", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
    await request(app.getHttpServer()).get("/team").expect(401);
  });

  it("sahte veya bozuk token reddedilir", async () => {
    await request(app.getHttpServer()).get("/auth/me").set("Authorization", "Bearer abc.def.ghi").expect(401);
  });

  it("hatalı parola genel bir hata mesajı döner", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "a@test.local", password: "yanlis-parola" })
      .expect(401);
    expect(res.body.message).toBe("E-posta veya parola hatalı");
  });

  it("5 hatalı denemeden sonra hesap geçici olarak kilitlenir", async () => {
    await createTenantWithUser(su, { name: "Kilit", email: "lock@test.local" });
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).post("/auth/login").send({ email: "lock@test.local", password: "x" });
    }
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "lock@test.local", password: TEST_PASSWORD })
      .expect(401);
    expect(res.body.message).toMatch(/Çok fazla/);
  });

  it("doğru giriş token ve üyelikleri döner; parola özeti dönmez", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "A@TEST.local", password: TEST_PASSWORD })
      .expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.memberships).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it("yeni işletme kaydı 14 günlük deneme ile başlar", async () => {
    const res = await registerTrial(app, { businessName: "Işıl Güzellik Stüdyosu", fullName: "Test Sahip", email: "yeni@test.local" });
    const m = res.body.user.memberships[0];
    expect(m.role).toBe("OWNER");
    expect(m.tenant.status).toBe("TRIAL");
    expect(m.tenant.slug).toBe("isil-guzellik-studyosu");
    const days = (new Date(m.tenant.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThanOrEqual(14);
  });

  it("zayıf parola, telefonsuz ve KVKK/koşul onaysız kayıt reddedilir", async () => {
    const ok = { businessName: "X Salon", fullName: "X Y", password: "GucluParola2026", phone: "0532 111 22 33", kvkkAccepted: true, termsAccepted: true };
    const http = () => request(app.getHttpServer()).post("/auth/register");
    await http().send({ ...ok, email: "zayif@test.local", password: "123" }).expect(400);
    await http().send({ ...ok, email: "kvkk@test.local", kvkkAccepted: undefined }).expect(400);
    await http().send({ ...ok, email: "kosul@test.local", termsAccepted: undefined }).expect(400);
    await http().send({ ...ok, email: "tel@test.local", phone: undefined }).expect(400);
    await http().send({ ...ok, email: "tel2@test.local", phone: "123456789012" }).expect(400);
  });

  it("X-Tenant-Id olmadan işletme uç noktası 400 döner", async () => {
    const token = await login(app, "a@test.local");
    await api(app, token).get("/team").expect(400);
  });

  it("üyesi olunmayan işletmeye erişim 403 döner", async () => {
    const token = await login(app, "a@test.local");
    await api(app, token, B.tenant.id).get("/team").expect(403);
  });

  it("ekip listesi yalnızca kendi işletmesinin üyelerini içerir", async () => {
    const token = await login(app, "a@test.local");
    const res = await api(app, token, A.tenant.id).get("/team").expect(200);
    expect(res.body.map((m: any) => m.user.email)).toEqual(["a@test.local"]);
  });

  it("OWNER personel ekler; STAFF ekip yönetemez", async () => {
    const ownerToken = await login(app, "a@test.local");
    const res = await addMember(app, api(app, ownerToken, A.tenant.id), { email: "personel@test.local", fullName: "Personel Bir", role: "STAFF" });
    expect(res.body).toMatchObject({ status: "SENT", delivered: true, role: "STAFF" });
    expect(res.body).not.toHaveProperty("temporaryPassword");
    const staffToken = await login(app, "personel@test.local", TEST_PASSWORD);
    await api(app, staffToken, A.tenant.id).get("/team").expect(403);
    await api(app, staffToken, A.tenant.id)
      .post("/team")
      .send({ email: "baska@test.local", fullName: "Başka", role: "OWNER" })
      .expect(403);
  });

  it("MANAGER, OWNER rolü veremez", async () => {
    const ownerToken = await login(app, "a@test.local");
    await addMember(app, api(app, ownerToken, A.tenant.id), { email: "mudur@test.local", fullName: "Müdür", role: "MANAGER" });
    const mgr = await login(app, "mudur@test.local", TEST_PASSWORD);
    await api(app, mgr, A.tenant.id)
      .post("/team")
      .send({ email: "sahip2@test.local", fullName: "Sahip İki", role: "OWNER" })
      .expect(403);
  });

  it("başka işletmenin üyeliği güncellenemez (404)", async () => {
    const bMember = await su.membership.findFirstOrThrow({ where: { tenantId: B.tenant.id } });
    const token = await login(app, "a@test.local");
    await api(app, token, A.tenant.id).patch(`/team/${bMember.id}`).send({ role: "STAFF" }).expect(404);
    const after = await su.membership.findUniqueOrThrow({ where: { id: bMember.id } });
    expect(after.role).toBe("OWNER");
  });

  it("askıya alınmış işletmeye erişim engellenir", async () => {
    await su.tenant.update({ where: { id: B.tenant.id }, data: { status: "SUSPENDED" } });
    const token = await login(app, "b@test.local");
    await api(app, token, B.tenant.id).get("/team").expect(403);
    await su.tenant.update({ where: { id: B.tenant.id }, data: { status: "ACTIVE" } });
  });

  it("süresi dolan denemede yazma işlemleri 402 döner", async () => {
    await su.tenant.update({
      where: { id: A.tenant.id },
      data: { status: "TRIAL", trialEndsAt: new Date(Date.now() - 1000) },
    });
    const token = await login(app, "a@test.local");
    await api(app, token, A.tenant.id).get("/team").expect(200);
    await api(app, token, A.tenant.id)
      .post("/team")
      .send({ email: "gec@test.local", fullName: "Geç Kalan", role: "STAFF" })
      .expect(402);
    await su.tenant.update({ where: { id: A.tenant.id }, data: { status: "ACTIVE" } });
  });

  it("işlemler denetim kaydına yazılır", async () => {
    const logs = await su.auditLog.findMany({ where: { tenantId: A.tenant.id, action: "tenant.member_invited" } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });
});
