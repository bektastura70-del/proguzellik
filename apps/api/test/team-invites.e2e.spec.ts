import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { loadEnv } from "../src/config/env";
import { MockEmailProvider } from "../src/email/email.provider";
import { addMember, api, createApp, createTenantWithUser, login, owner, resetDb, TEST_PASSWORD } from "./helpers";

const inviteToken = (text: string) => /davet\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

describe("İşletme ekibi: güvenli davet (geçici parola yok)", () => {
  const su = owner();
  let app: INestApplication;
  let a: ReturnType<typeof api>;
  let b: ReturnType<typeof api>;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let outbox: MockEmailProvider["outbox"];
  const env = loadEnv();
  const mail = (to: string) => [...outbox].reverse().find((m) => m.to === to);

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    app = await createApp();
    outbox = app.get(MockEmailProvider).outbox;
    a = api(app, await login(app, "a@test.local"), A.tenant.id);
    const B = await su.tenant.findFirstOrThrow({ where: { name: "Salon B" } });
    b = api(app, await login(app, "b@test.local"), B.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("davet hesap ya da parola oluşturmaz; bağlantı tek kullanımlıktır", async () => {
    const r = await a.post("/team").send({ email: "Yeni@Test.local", fullName: "Yeni Kişi", role: "STAFF" }).expect(201);
    expect(r.body).toMatchObject({ email: "yeni@test.local", status: "SENT", delivered: true });
    expect(r.body).not.toHaveProperty("temporaryPassword");
    expect(r.body).not.toHaveProperty("tokenHash");
    expect(await su.user.findUnique({ where: { email: "yeni@test.local" } })).toBeNull();
    const token = inviteToken(mail("yeni@test.local")!.text);
    await request(app.getHttpServer()).post("/auth/accept-invite").send({ token, password: TEST_PASSWORD, kvkkAccepted: true }).expect(200);
    await request(app.getHttpServer()).post("/auth/accept-invite").send({ token, password: TEST_PASSWORD, kvkkAccepted: true }).expect(400);
    const m = await su.membership.findFirstOrThrow({ where: { tenantId: A.tenant.id, user: { email: "yeni@test.local" } } });
    expect(m.role).toBe("STAFF");
    expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: "tenant.member_invited" } })).toBe(1);
  });

  it("sahip rolü davetle verilemez; aynı e-postaya ikinci açık davet reddedilir", async () => {
    await a.post("/team").send({ email: "o2@test.local", fullName: "Sahip İki", role: "OWNER" }).expect(400);
    await a.post("/team").send({ email: "cift@test.local", fullName: "Çift Kişi", role: "STAFF" }).expect(201);
    await a.post("/team").send({ email: "cift@test.local", fullName: "Çift Kişi", role: "MANAGER" }).expect(409);
  });

  it("davetler işletmeye özeldir: başka işletme göremez, yenileyemez, iptal edemez", async () => {
    const list = (await a.get("/team/invites").expect(200)).body;
    const inv = list.find((i: { email: string }) => i.email === "cift@test.local");
    expect(inv).toBeTruthy();
    expect(list[0]).not.toHaveProperty("tokenHash");
    expect((await b.get("/team/invites").expect(200)).body).toEqual([]);
    await b.post(`/team/invites/${inv.id}/resend`).expect(404);
    await b.post(`/team/invites/${inv.id}/revoke`).expect(404);
    const old = inviteToken(mail("cift@test.local")!.text);
    await a.post(`/team/invites/${inv.id}/resend`).expect(200);
    // Yeniden gönderim eski bağlantıyı geçersiz kılar.
    await request(app.getHttpServer()).post("/auth/accept-invite").send({ token: old, password: TEST_PASSWORD, kvkkAccepted: true }).expect(400);
    await a.post(`/team/invites/${inv.id}/revoke`).expect(200);
    const fresh = inviteToken(mail("cift@test.local")!.text);
    await request(app.getHttpServer()).post("/auth/accept-invite").send({ token: fresh, password: TEST_PASSWORD, kvkkAccepted: true }).expect(400);
  });

  it("personel ve resepsiyon davet gönderemez", async () => {
    await addMember(app, a, { email: "rec@test.local", fullName: "Resepsiyon", role: "RECEPTION" });
    const rec = api(app, await login(app, "rec@test.local"), A.tenant.id);
    await rec.post("/team").send({ email: "x@test.local", fullName: "X Kişi", role: "STAFF" }).expect(403);
    await rec.get("/team/invites").expect(403);
  });

  it("canlıda SMTP yoksa davet gönderilmiş gibi gösterilmez", async () => {
    const saved = { NODE_ENV: env.NODE_ENV, EMAIL_MODE: env.EMAIL_MODE };
    Object.assign(env, { NODE_ENV: "production", EMAIL_MODE: "mock" });
    try {
      const before = outbox.length;
      const r = await a.post("/team").send({ email: "smtpyok@test.local", fullName: "SMTP Yok", role: "STAFF" }).expect(201);
      expect(r.body).toMatchObject({ delivered: false, code: "EMAIL_NOT_CONFIGURED", status: "PENDING_DELIVERY" });
      expect(r.body.reason).toMatch(/GÖNDERİLMEDİ/);
      expect(outbox.length).toBe(before);
    } finally {
      Object.assign(env, saved);
    }
  });
});
