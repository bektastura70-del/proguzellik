import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import request from "supertest";
import { MockEmailProvider } from "../src/email/email.provider";
import { currentStep, totp } from "../src/security/crypto";
import { api, createApp, createTenantWithUser, enableMfa, freshTotp, login, loginWithMfa, owner, resetDb, TEST_PASSWORD, addMember, registerTrial } from "./helpers";

const linkToken = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

describe("Kimlik güvenliği: oturumlar, parola sıfırlama, e-posta doğrulama, 2FA", () => {
  const su = owner();
  let app: INestApplication;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let outbox: MockEmailProvider["outbox"];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    await su.user.create({ data: { email: "admin@proguzellik.test", fullName: "SaaS Sahibi", passwordHash: (await su.user.findFirstOrThrow()).passwordHash, isPlatformAdmin: true, emailVerifiedAt: new Date() } });
    app = await createApp();
    outbox = app.get(MockEmailProvider).outbox;
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  describe("oturum yönetimi", () => {
    it("her giriş ayrı oturum açar; oturumlar listelenir ve tek tek kapatılabilir", async () => {
      const t1 = await login(app, "a@test.local");
      const t2 = await login(app, "a@test.local");
      const list = await http().get("/auth/sessions").set("Authorization", `Bearer ${t1}`).expect(200);
      expect(list.body.length).toBeGreaterThanOrEqual(2);
      expect(list.body.filter((s: any) => s.current)).toHaveLength(1);
      const other = list.body.find((s: any) => !s.current);
      await http().delete(`/auth/sessions/${other.id}`).set("Authorization", `Bearer ${t1}`).expect(200);
      await http().get("/auth/me").set("Authorization", `Bearer ${t2}`).expect(401);
      await http().get("/auth/me").set("Authorization", `Bearer ${t1}`).expect(200);
    });

    it("çıkış yapılan oturumun token'ı artık geçersizdir; diğer oturumları kapatma çalışır", async () => {
      const t1 = await login(app, "a@test.local");
      const t2 = await login(app, "a@test.local");
      const t3 = await login(app, "a@test.local");
      await http().post("/auth/logout").set("Authorization", `Bearer ${t1}`).expect(200);
      await http().get("/auth/me").set("Authorization", `Bearer ${t1}`).expect(401);
      const r = await http().post("/auth/logout-others").set("Authorization", `Bearer ${t2}`).expect(200);
      expect(r.body.revoked).toBeGreaterThanOrEqual(1);
      await http().get("/auth/me").set("Authorization", `Bearer ${t3}`).expect(401);
      await http().get("/auth/me").set("Authorization", `Bearer ${t2}`).expect(200);
    });

    it("hareketsiz kalan oturum sona erer", async () => {
      const t = await login(app, "a@test.local");
      const sid = (app.get(JwtService).decode(t) as { sid: string }).sid;
      await su.session.update({ where: { id: sid }, data: { lastSeenAt: new Date(Date.now() - 3 * 3_600_000) } });
      await http().get("/auth/me").set("Authorization", `Bearer ${t}`).expect(401);
    });

    it("başka bir kullanıcının oturumu kapatılamaz; oturumsuz (sid'siz) token reddedilir", async () => {
      const ta = await login(app, "a@test.local");
      const tb = (await registerTrial(app, { businessName: "Salon B", fullName: "Bb", email: "b@test.local" })).body.accessToken;
      const sidA = (app.get(JwtService).decode(ta) as { sid: string }).sid;
      await http().delete(`/auth/sessions/${sidA}`).set("Authorization", `Bearer ${tb}`).expect(404);
      const legacy = await app.get(JwtService).signAsync({ sub: A.user.id });
      await http().get("/auth/me").set("Authorization", `Bearer ${legacy}`).expect(401);
    });
  });

  describe("parola sıfırlama", () => {
    it("bilinmeyen e-posta için aynı yanıt döner ve e-posta gönderilmez", async () => {
      const before = outbox.length;
      const r = await http().post("/auth/forgot-password").send({ email: "yok@test.local" }).expect(200);
      expect(r.body.message).toMatch(/hesap varsa/);
      expect(outbox.length).toBe(before);
    });

    it("bağlantıyla parola sıfırlanır; tüm oturumlar kapanır; bağlantı ikinci kez kullanılamaz", async () => {
      const old = await login(app, "a@test.local");
      await http().post("/auth/forgot-password").send({ email: "A@test.local" }).expect(200);
      const mail = outbox.filter((m) => m.to === "a@test.local" && m.subject === "Parola sıfırlama").at(-1)!;
      const token = linkToken(mail.text);
      expect(token.length).toBeGreaterThan(30);
      expect(mail.text).toContain("/parola-sifirla?token=");
      // Belirteç veritabanında açık metin olarak saklanmaz.
      expect(await su.authToken.count({ where: { tokenHash: token } })).toBe(0);
      await http().post("/auth/reset-password").send({ token, newPassword: "kisa" }).expect(400);
      await http().post("/auth/reset-password").send({ token, newPassword: "YeniGuclu2026" }).expect(200);
      await http().post("/auth/reset-password").send({ token, newPassword: "BaskaParola2026" }).expect(400);
      await http().get("/auth/me").set("Authorization", `Bearer ${old}`).expect(401);
      await http().post("/auth/login").send({ email: "a@test.local", password: TEST_PASSWORD }).expect(401);
      await http().post("/auth/login").send({ email: "a@test.local", password: "YeniGuclu2026" }).expect(200);
      expect(outbox.some((m) => m.to === "a@test.local" && m.subject === "Parolanız değiştirildi")).toBe(true);
      await su.user.update({ where: { id: A.user.id }, data: { passwordHash: (await su.user.findFirstOrThrow({ where: { email: "admin@proguzellik.test" } })).passwordHash } });
    });

    it("yeni istek eski bağlantıyı geçersiz kılar; süresi dolmuş bağlantı reddedilir", async () => {
      await http().post("/auth/forgot-password").send({ email: "a@test.local" }).expect(200);
      const first = linkToken(outbox.filter((m) => m.to === "a@test.local" && m.subject === "Parola sıfırlama").at(-1)!.text);
      await http().post("/auth/forgot-password").send({ email: "a@test.local" }).expect(200);
      const second = linkToken(outbox.filter((m) => m.to === "a@test.local" && m.subject === "Parola sıfırlama").at(-1)!.text);
      await http().post("/auth/reset-password").send({ token: first, newPassword: "YeniGuclu2026" }).expect(400);
      await su.authToken.updateMany({ where: { userId: A.user.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post("/auth/reset-password").send({ token: second, newPassword: "YeniGuclu2026" }).expect(400);
    });

    it("aynı e-posta için saatte en fazla 3 sıfırlama isteği", async () => {
      process.env.DISABLE_RATE_LIMIT = "0";
      try {
        const codes: number[] = [];
        for (let i = 0; i < 4; i++) codes.push((await http().post("/auth/forgot-password").send({ email: "limit@test.local" })).status);
        expect(codes).toEqual([200, 200, 200, 429]);
      } finally {
        process.env.DISABLE_RATE_LIMIT = "1";
      }
    });
  });

  describe("e-posta doğrulama", () => {
    // Deneme kaydında e-posta hesap açılmadan doğrulanır; bu akış doğrulanmamış eski/davetli hesaplar içindir.
    const unverified = async (email: string, name: string) => {
      const t = await createTenantWithUser(su, { name, email, status: "TRIAL" });
      await su.user.update({ where: { id: t.user.id }, data: { emailVerifiedAt: null } });
      return t;
    };

    it("doğrulanmamış hesap ödeme yapamaz; doğrulama tek kullanımlıktır", async () => {
      const u = await unverified("yeni@test.local", "Yeni Salon");
      const t = api(app, await login(app, "yeni@test.local"), u.tenant.id);
      expect((await t.get("/auth/me").expect(200)).body.emailVerified).toBe(false);
      const blocked = await t.post("/subscription/checkout").send({ planCode: "STARTER", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(403);
      expect(blocked.body.code).toBe("EMAIL_NOT_VERIFIED");
      await t.post("/auth/resend-verification").expect(200);
      const mail = outbox.filter((m) => m.to === "yeni@test.local" && m.subject === "E-posta adresinizi doğrulayın").at(-1)!;
      const token = linkToken(mail.text);
      await http().post("/auth/verify-email").send({ token }).expect(200);
      await http().post("/auth/verify-email").send({ token }).expect(400);
      const me = await t.get("/auth/me").expect(200);
      expect(me.body.emailVerified).toBe(true);
      await t.post("/subscription/checkout").send({ planCode: "STARTER", billingCycle: "MONTHLY", paymentToken: "tok_test" }).expect(201);
    });

    it("doğrulama e-postası tekrar istenebilir; eski bağlantı geçersiz olur", async () => {
      await unverified("iki@test.local", "Ikinci");
      const tok = await login(app, "iki@test.local");
      await http().post("/auth/resend-verification").set("Authorization", `Bearer ${tok}`).expect(200);
      const first = linkToken(outbox.filter((m) => m.to === "iki@test.local").at(-1)!.text);
      await http().post("/auth/resend-verification").set("Authorization", `Bearer ${tok}`).expect(200);
      const second = linkToken(outbox.filter((m) => m.to === "iki@test.local").at(-1)!.text);
      expect(second).not.toBe(first);
      await http().post("/auth/verify-email").send({ token: first }).expect(400);
      await http().post("/auth/verify-email").send({ token: second }).expect(200);
    });
  });

  describe("iki adımlı doğrulama (TOTP)", () => {
    let secret = "";
    let codes: string[] = [];

    it("kurulum parola ister; yanlış kod reddedilir; açılınca 10 kurtarma kodu verilir; gizli anahtar şifreli saklanır", async () => {
      const t = await login(app, "a@test.local");
      await http().post("/auth/mfa/setup").set("Authorization", `Bearer ${t}`).send({ password: "yanlis" }).expect(401);
      const s = await http().post("/auth/mfa/setup").set("Authorization", `Bearer ${t}`).send({ password: TEST_PASSWORD }).expect(200);
      secret = s.body.secret;
      expect(s.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/ProG%C3%BCzellik%3Aa%40test\.local\?secret=/);
      await http().post("/auth/mfa/enable").set("Authorization", `Bearer ${t}`).send({ code: "000000" }).expect(400);
      const en = await http().post("/auth/mfa/enable").set("Authorization", `Bearer ${t}`).send({ code: totp(secret, currentStep()) }).expect(200);
      codes = en.body.recoveryCodes;
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      const u = await su.user.findUniqueOrThrow({ where: { id: A.user.id } });
      expect(u.mfaSecretEnc).toBeTruthy();
      expect(u.mfaSecretEnc).not.toContain(secret);
      expect(await su.recoveryCode.count({ where: { userId: A.user.id, codeHash: codes[0] } })).toBe(0);
    });

    it("girişte ikinci adım istenir; mfaToken ile API'ye erişilemez; yanlış kod reddedilir", async () => {
      const r = await http().post("/auth/login").send({ email: "a@test.local", password: TEST_PASSWORD }).expect(200);
      expect(r.body).toMatchObject({ mfaRequired: true });
      expect(r.body.accessToken).toBeUndefined();
      await http().get("/auth/me").set("Authorization", `Bearer ${r.body.mfaToken}`).expect(401);
      await http().post("/auth/mfa/verify").send({ mfaToken: r.body.mfaToken, code: "123456" }).expect(401);
    });

    it("doğru kodla giriş; aynı kod ikinci kez kullanılamaz", async () => {
      const r1 = await http().post("/auth/login").send({ email: "a@test.local", password: TEST_PASSWORD }).expect(200);
      const code = await freshTotp("a@test.local", secret);
      const ok = await http().post("/auth/mfa/verify").send({ mfaToken: r1.body.mfaToken, code }).expect(200);
      expect(ok.body.user.mfaEnabled).toBe(true);
      const r2 = await http().post("/auth/login").send({ email: "a@test.local", password: TEST_PASSWORD }).expect(200);
      await http().post("/auth/mfa/verify").send({ mfaToken: r2.body.mfaToken, code }).expect(401);
    });

    it("kurtarma kodu bir kez çalışır", async () => {
      const r1 = await http().post("/auth/login").send({ email: "a@test.local", password: TEST_PASSWORD }).expect(200);
      await http().post("/auth/mfa/verify").send({ mfaToken: r1.body.mfaToken, recoveryCode: codes[0].toUpperCase() }).expect(200);
      const r2 = await http().post("/auth/login").send({ email: "a@test.local", password: TEST_PASSWORD }).expect(200);
      await http().post("/auth/mfa/verify").send({ mfaToken: r2.body.mfaToken, recoveryCode: codes[0] }).expect(401);
      const tok = await loginWithMfa(app, "a@test.local", secret);
      const me = await http().get("/auth/me").set("Authorization", `Bearer ${tok}`).expect(200);
      expect(me.body.recoveryCodesLeft).toBe(9);
    });

    it("5 hatalı 2FA denemesinde hesap geçici olarak kilitlenir", async () => {
      await su.user.update({ where: { id: A.user.id }, data: { mfaFailedAttempts: 0, lockedUntil: null } });
      for (let i = 0; i < 5; i++) {
        const r = await http().post("/auth/login").send({ email: "a@test.local", password: TEST_PASSWORD }).expect(200);
        await http().post("/auth/mfa/verify").send({ mfaToken: r.body.mfaToken, code: "000001" }).expect(401);
      }
      await http().post("/auth/login").send({ email: "a@test.local", password: TEST_PASSWORD }).expect(401);
      await su.user.update({ where: { id: A.user.id }, data: { lockedUntil: null, mfaFailedAttempts: 0 } });
    });

    it("işletme 2FA zorunluluğu: sahip 2FA'sız açamaz; açılınca 2FA'sız yönetici engellenir, resepsiyon etkilenmez", async () => {
      const ownerT = await loginWithMfa(app, "a@test.local", secret);
      const o = api(app, ownerT, A.tenant.id);
      const inv1 = await addMember(app, o, { email: "mgr@test.local", fullName: "Müdür", role: "MANAGER" });
      const inv2 = await addMember(app, o, { email: "rec@test.local", fullName: "Resepsiyon", role: "RECEPTION" });
      const mgr = api(app, await login(app, "mgr@test.local", TEST_PASSWORD), A.tenant.id);
      const rec = api(app, await login(app, "rec@test.local", TEST_PASSWORD), A.tenant.id);
      await mgr.patch("/settings").send({ requireMfa: true }).expect(403);
      await o.patch("/settings").send({ requireMfa: true }).expect(200);
      const blocked = await mgr.get("/customers").expect(403);
      expect(blocked.body.code).toBe("MFA_SETUP_REQUIRED");
      await rec.get("/customers").expect(200);
      await o.get("/customers").expect(200);
      await o.patch("/settings").send({ requireMfa: false }).expect(200);
      await mgr.get("/customers").expect(200);
    });

    it("2FA kapatma parola + kod ister", async () => {
      const t = await loginWithMfa(app, "a@test.local", secret);
      await http().post("/auth/mfa/disable").set("Authorization", `Bearer ${t}`).send({ password: TEST_PASSWORD, code: "000000" }).expect(401);
      await http().post("/auth/mfa/disable").set("Authorization", `Bearer ${t}`).send({ password: TEST_PASSWORD, code: await freshTotp("a@test.local", secret) }).expect(200);
      const r = await http().post("/auth/login").send({ email: "a@test.local", password: TEST_PASSWORD }).expect(200);
      expect(r.body.accessToken).toBeTruthy();
      expect(await su.recoveryCode.count({ where: { userId: A.user.id } })).toBe(0);
    });

    it("SaaS yöneticisi: 2FA olmadan panel kapalı; 2FA açılınca erişir ve kapatamaz", async () => {
      const t = await login(app, "admin@proguzellik.test");
      const r = await http().get("/platform/stats").set("Authorization", `Bearer ${t}`).expect(403);
      expect(r.body.code).toBe("MFA_SETUP_REQUIRED");
      const m = await enableMfa(app, "admin@proguzellik.test");
      await http().get("/platform/stats").set("Authorization", `Bearer ${m.token}`).expect(200);
      const r2 = await http().post("/auth/login").send({ email: "admin@proguzellik.test", password: TEST_PASSWORD }).expect(200);
      expect(r2.body.mfaRequired).toBe(true);
      await http().post("/auth/mfa/disable").set("Authorization", `Bearer ${m.token}`).send({ password: TEST_PASSWORD, code: await freshTotp("admin@proguzellik.test", m.secret) }).expect(403);
    });
  });

  it("hazırlık sağlık kontrolü veritabanı ve Redis'i doğrular", async () => {
    const r = await http().get("/health/ready").expect(200);
    expect(r.body.checks).toEqual({ database_tenant: "ok", database_platform: "ok", redis: "ok" });
  });
});
