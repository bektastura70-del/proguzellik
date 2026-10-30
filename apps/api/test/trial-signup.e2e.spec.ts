import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { loadEnv } from "../src/config/env";
import { normalizePhone } from "../src/auth/auth.service";
import { MockEmailProvider } from "../src/email/email.provider";
import { JobsService } from "../src/jobs/jobs.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { createApp, createTenantWithUser, owner, registerTrial, resetDb, TEST_PASSWORD, testPhone, trialToken } from "./helpers";

const DAY = 86_400_000;

describe("Telefon normalleştirme (birim)", () => {
  it("0 / 90 / +90 önekli ve boşluklu numaraları aynı biçime getirir", () => {
    for (const v of ["0532 123 45 67", "+90 (532) 123-45-67", "905321234567", "5321234567"]) expect(normalizePhone(v)).toBe("+905321234567");
    for (const v of ["123", "0632 123 45 67", "05321234567890"]) expect(() => normalizePhone(v)).toThrow();
  });
});

describe("14 gün ücretsiz deneme: başvuru → e-posta doğrulama → işletme", () => {
  const su = owner();
  const env = loadEnv();
  let app: INestApplication;
  let outbox: MockEmailProvider["outbox"];
  const http = () => request(app.getHttpServer());
  const form = (o: Record<string, unknown> = {}) => ({ businessName: "Deneme Salonu", fullName: "Deneme Sahip", email: "deneme@test.local", password: TEST_PASSWORD, phone: testPhone(), kvkkAccepted: true, termsAccepted: true, ...o });
  const saved = { REGISTRATION_ENABLED: env.REGISTRATION_ENABLED, NODE_ENV: env.NODE_ENV, EMAIL_MODE: env.EMAIL_MODE };

  beforeAll(async () => {
    await resetDb(su);
    await su.signupRequest.deleteMany();
    app = await createApp();
    outbox = app.get(MockEmailProvider).outbox;
  });
  afterEach(() => Object.assign(env, saved));
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("başvuruda hesap/işletme oluşmaz; doğrulamada açılır ve deneme o anda başlar", async () => {
    const r = await http().post("/auth/register").send(form({ email: "Yeni.Salon@Test.local", marketingConsent: true })).expect(202);
    expect(r.body).toEqual({ status: "VERIFICATION_SENT", email: "yeni.salon@test.local", expiresInHours: 24 });
    expect(JSON.stringify(r.body)).not.toMatch(/token|accessToken/);
    expect(await su.user.findUnique({ where: { email: "yeni.salon@test.local" } })).toBeNull();
    expect(await su.tenant.count({ where: { name: "Deneme Salonu" } })).toBe(0);
    const pending = await su.signupRequest.findUniqueOrThrow({ where: { email: "yeni.salon@test.local" } });
    expect(pending.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(pending.tokenHash).toHaveLength(64);

    // Geç doğrulama: deneme süresi başvurudan değil doğrulamadan itibaren sayılır
    await su.signupRequest.update({ where: { id: pending.id }, data: { createdAt: new Date(Date.now() - 20 * 3_600_000) } });
    const token = trialToken(app, "yeni.salon@test.local")!;
    const c = await http().post("/auth/register/confirm").send({ token }).expect(200);
    expect(c.body.accessToken).toBeTruthy();
    expect(c.body.user.emailVerified).toBe(true);
    const tenant = c.body.user.memberships[0].tenant;
    expect(tenant.status).toBe("TRIAL");
    const days = (new Date(tenant.trialEndsAt).getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(13.99);
    expect(await su.signupRequest.count({ where: { email: "yeni.salon@test.local" } })).toBe(0);
    const user = await su.user.findUniqueOrThrow({ where: { email: "yeni.salon@test.local" } });
    const consents = await su.userConsent.findMany({ where: { userId: user.id }, orderBy: { type: "asc" } });
    expect(consents.map((x) => [x.type, x.granted])).toEqual([["KVKK_NOTICE", true], ["TERMS", true], ["MARKETING", true]]);
    expect(consents[0].version).toMatch(/^\/kvkk@/);
    expect(await su.auditLog.count({ where: { action: "tenant.registered", actorId: user.id } })).toBe(1);

    // Bağlantı tek kullanımlıktır
    await http().post("/auth/register/confirm").send({ token }).expect(400);
  });

  it("ticari ileti onayı varsayılan olarak verilmez", async () => {
    const c = await registerTrial(app, { businessName: "Onaysız Salon", fullName: "Onay Yok", email: "onayyok@test.local" });
    const m = await su.userConsent.findFirstOrThrow({ where: { userId: c.body.user.id, type: "MARKETING" } });
    expect(m.granted).toBe(false);
  });

  it("süresi dolmuş bağlantı reddedilir ve günlük görev eski başvuruları siler", async () => {
    await http().post("/auth/register").send(form({ email: "gec@test.local" })).expect(202);
    await su.signupRequest.update({ where: { email: "gec@test.local" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await http().post("/auth/register/confirm").send({ token: trialToken(app, "gec@test.local") }).expect(400);
    expect(await su.user.findUnique({ where: { email: "gec@test.local" } })).toBeNull();
    const r = await app.get(JobsService).runDaily({ force: true });
    expect((r as { result: { expiredSignups: number } }).result.expiredSignups).toBeGreaterThanOrEqual(1);
    expect(await su.signupRequest.count({ where: { email: "gec@test.local" } })).toBe(0);
  });

  it("aynı e-postayla yeni başvuru öncekinin bağlantısını geçersiz kılar", async () => {
    await http().post("/auth/register").send(form({ email: "iki@test.local" })).expect(202);
    const first = trialToken(app, "iki@test.local");
    await http().post("/auth/register").send(form({ email: "iki@test.local", businessName: "İkinci Ad" })).expect(202);
    const second = trialToken(app, "iki@test.local");
    expect(second).not.toBe(first);
    await http().post("/auth/register/confirm").send({ token: first }).expect(400);
    const c = await http().post("/auth/register/confirm").send({ token: second }).expect(200);
    expect(c.body.user.memberships[0].tenant.name).toBe("İkinci Ad");
  });

  it("kayıtlı e-postaya aynı yanıt verilir; ikinci hesap/işletme açılmaz, sahibine bilgi gider", async () => {
    await createTenantWithUser(su, { name: "Var Olan", email: "var@test.local" });
    const before = await su.tenant.count();
    const r = await http().post("/auth/register").send(form({ email: "var@test.local" })).expect(202);
    expect(r.body.status).toBe("VERIFICATION_SENT");
    expect(await su.tenant.count()).toBe(before);
    expect(await su.signupRequest.count({ where: { email: "var@test.local" } })).toBe(0);
    expect(outbox.some((m) => m.to === "var@test.local" && m.subject === "ProGüzellik hesabınız zaten var")).toBe(true);
    expect(trialToken(app, "var@test.local")).toBeUndefined();
  });

  it("açık deneme hesabındaki telefonla yeni deneme açılmaz (biçim farkı önemsiz)", async () => {
    await registerTrial(app, { businessName: "Telefonlu", fullName: "Tel Sahip", email: "tel1@test.local", phone: "0533 444 55 66" });
    const r = await http().post("/auth/register").send(form({ email: "tel2@test.local", phone: "+90 533 444 5566" })).expect(409);
    expect(r.body.message).toMatch(/telefon/);
    expect(await su.signupRequest.count({ where: { email: "tel2@test.local" } })).toBe(0);
  });

  it("aynı anda iki doğrulama isteğinden yalnızca biri hesap açar", async () => {
    await http().post("/auth/register").send(form({ email: "yaris@test.local", businessName: "Yarış Salonu" })).expect(202);
    const token = trialToken(app, "yaris@test.local");
    const rs = await Promise.all([1, 2, 3].map(() => http().post("/auth/register/confirm").send({ token })));
    expect(rs.filter((x) => x.status === 200)).toHaveLength(1);
    expect(await su.tenant.count({ where: { name: "Yarış Salonu" } })).toBe(1);
  });

  it("aynı e-postayla saatte 3'ten fazla başvuru engellenir", async () => {
    process.env.DISABLE_RATE_LIMIT = "0";
    try {
      for (let i = 0; i < 3; i++) await http().post("/auth/register").send(form({ email: "spam@test.local" })).expect(202);
      await http().post("/auth/register").send(form({ email: "spam@test.local" })).expect(429);
    } finally {
      process.env.DISABLE_RATE_LIMIT = "1";
    }
  });

  it("canlıda SMTP yoksa 503 döner ve hiçbir kayıt yazılmaz", async () => {
    Object.assign(env, { NODE_ENV: "production", EMAIL_MODE: "mock", REGISTRATION_ENABLED: "1" });
    const counts = async () => [await su.signupRequest.count(), await su.user.count(), await su.tenant.count(), await su.outboundEmail.count()];
    const before = await counts();
    const r = await http().post("/auth/register").send(form({ email: "smtpyok@test.local" })).expect(503);
    expect(r.body.code).toBe("EMAIL_NOT_CONFIGURED");
    expect(await counts()).toEqual(before);
  });

  it("kayıt kapalıyken başvuru ve doğrulama 403", async () => {
    await http().post("/auth/register").send(form({ email: "kapali@test.local" })).expect(202);
    const token = trialToken(app, "kapali@test.local");
    env.REGISTRATION_ENABLED = "0";
    Object.assign(env, { NODE_ENV: "production", EMAIL_MODE: "smtp" });
    await http().post("/auth/register").send({ junk: true }).expect(403);
    await http().post("/auth/register/confirm").send({ token }).expect(403);
  });

  it("işletme veritabanı rolü başvuru ve onay tablolarına erişemez", async () => {
    const prisma = app.get(PrismaService);
    await expect(prisma.tenant.signupRequest.findMany()).rejects.toThrow(/permission denied/);
    await expect(prisma.tenant.userConsent.findMany()).rejects.toThrow(/permission denied/);
  });
});
