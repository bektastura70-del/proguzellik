import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { loadEnv } from "../src/config/env";
import { MockEmailProvider } from "../src/email/email.provider";
import { api, createApp, createTenantWithUser, enableMfa, freshTotp, login, loginWithMfa, owner, resetDb, TEST_PASSWORD } from "./helpers";

const inviteToken = (text: string) => /davet\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";
const resetToken = (text: string) => /parola-sifirla\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";
const NEW_PASSWORD = "YeniParola2026";

describe("SaaS sahibi: kullanıcı yönetimi", () => {
  const su = owner();
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let adminId: string;
  let adminSecret: string;
  let outbox: MockEmailProvider["outbox"];
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  const env = loadEnv();
  const http = () => request(app.getHttpServer());
  const lastMail = (to: string) => [...outbox].reverse().find((m) => m.to === to);
  const membershipOf = (tenantId: string, email: string) => su.membership.findFirstOrThrow({ where: { tenantId, user: { email } } });

  /** Davet eder, e-postadaki bağlantıyla parolayı belirleyip hesabı açar. */
  async function inviteAndAccept(tenantId: string, email: string, role: "MANAGER" | "RECEPTION" | "STAFF") {
    const r = await admin.post(`/platform/tenants/${tenantId}/members`).send({ fullName: "Davetli Kişi", email, role }).expect(201);
    expect(r.body).toMatchObject({ status: "SENT", delivered: true, role });
    const token = inviteToken(lastMail(email)!.text);
    await http().post("/auth/accept-invite").send({ token, password: NEW_PASSWORD, kvkkAccepted: true }).expect(200);
    return r.body;
  }

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local" });
    adminId = (
      await su.user.create({
        data: { email: "admin@proguzellik.test", fullName: "Platform Sahibi", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true },
      })
    ).id;
    app = await createApp();
    outbox = app.get(MockEmailProvider).outbox;
    const adm = await enableMfa(app, "admin@proguzellik.test");
    adminSecret = adm.secret;
    admin = api(app, adm.token);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  describe("yetki", () => {
    it("işletme sahibi ve oturumsuz istek kullanıcı yönetimine erişemez", async () => {
      const a = api(app, await login(app, "a@test.local"), A.tenant.id);
      const m = await membershipOf(B.tenant.id, "b@test.local");
      await a.get("/platform/users").expect(403);
      await a.get(`/platform/users/${B.user.id}`).expect(403);
      await a.patch(`/platform/memberships/${m.id}`).send({ role: "STAFF" }).expect(403);
      await a.post(`/platform/memberships/${m.id}/deactivate`).send({}).expect(403);
      await a.post(`/platform/users/${B.user.id}/deactivate`).send({ reason: "deneme" }).expect(403);
      await a.post(`/platform/users/${B.user.id}/password-reset`).send({}).expect(403);
      await a.post(`/platform/tenants/${B.tenant.id}/members`).send({ fullName: "Sızma", email: "x@ornek.test", role: "MANAGER" }).expect(403);
      await http().get("/platform/users").expect(401);
      expect((await su.membership.findUniqueOrThrow({ where: { id: m.id } })).role).toBe("OWNER");
      expect(await su.tenantInvite.count()).toBe(0);
    });
  });

  describe("listeleme, arama, filtre", () => {
    it("tüm işletmelerin kullanıcılarını gizli alanlar olmadan listeler", async () => {
      const r = await admin.get("/platform/users").expect(200);
      expect(r.body.total).toBe(3);
      const raw = JSON.stringify(r.body);
      for (const secret of ["passwordHash", "mfaSecretEnc", "mfaPendingSecretEnc", "$2"]) expect(raw).not.toContain(secret);
      const a = r.body.items.find((u: any) => u.email === "a@test.local");
      expect(a).toMatchObject({ isActive: true, emailVerified: true, mfaEnabled: false, locked: false, memberships: [{ role: "OWNER", isActive: true, tenant: { name: "Salon A" } }] });
    });

    it("arama, işletme, rol, durum ve tür filtreleri; sayfalama", async () => {
      expect((await admin.get("/platform/users?search=b@test").expect(200)).body.items.map((u: any) => u.email)).toEqual(["b@test.local"]);
      expect((await admin.get("/platform/users?search=Salon%20A").expect(200)).body.items.map((u: any) => u.email)).toEqual(["a@test.local"]);
      expect((await admin.get(`/platform/users?tenantId=${B.tenant.id}`).expect(200)).body.items.map((u: any) => u.email)).toEqual(["b@test.local"]);
      expect((await admin.get("/platform/users?role=OWNER").expect(200)).body.total).toBe(2);
      expect((await admin.get("/platform/users?kind=platform").expect(200)).body.items.map((u: any) => u.email)).toEqual(["admin@proguzellik.test"]);
      expect((await admin.get("/platform/users?status=inactive").expect(200)).body.total).toBe(0);
      const page = await admin.get("/platform/users?take=1&skip=1").expect(200);
      expect(page.body.items).toHaveLength(1);
      expect(page.body.total).toBe(3);
      await admin.get("/platform/users?role=ADMIN").expect(400);
      await admin.get("/platform/users?take=1000").expect(400);
    });

    it("detayda üyelikler, oturum sayısı ve denetim kaydı döner", async () => {
      const r = await admin.get(`/platform/users/${A.user.id}`).expect(200);
      expect(r.body).toMatchObject({ email: "a@test.local", memberships: [{ role: "OWNER" }] });
      expect(typeof r.body.activeSessions).toBe("number");
      expect(Array.isArray(r.body.audit)).toBe(true);
      await admin.get("/platform/users/00000000-0000-4000-8000-000000000000").expect(404);
    });
  });

  describe("davetle yönetici ve personel hesabı açma", () => {
    it("yönetici daveti: e-postada rol yazar, davetli parolasını belirler, yalnızca kendi işletmesine erişir", async () => {
      const inv = await inviteAndAccept(A.tenant.id, "mudur@ornek.test", "MANAGER");
      expect(lastMail("mudur@ornek.test")!.text).toMatch(/Salon A işletmesine yönetici olarak/);
      const m = await membershipOf(A.tenant.id, "mudur@ornek.test");
      expect(m).toMatchObject({ role: "MANAGER", isActive: true });
      const user = await su.user.findUniqueOrThrow({ where: { email: "mudur@ornek.test" } });
      expect(user.mustChangePassword).toBe(false);
      expect(await bcrypt.compare(NEW_PASSWORD, user.passwordHash)).toBe(true);
      // Kiracı izolasyonu
      const token = await login(app, "mudur@ornek.test", NEW_PASSWORD);
      await api(app, token, A.tenant.id).get("/team").expect(200);
      await api(app, token, B.tenant.id).get("/team").expect(403);
      await api(app, token, B.tenant.id).get("/customers").expect(403);
      // Denetim
      expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: "platform.member_invited", entityId: inv.id } })).toBe(1);
      expect(await su.auditLog.count({ where: { tenantId: A.tenant.id, action: "tenant.invite_accepted", entityId: inv.id } })).toBe(1);
    });

    it("davet önizlemesi rolü gösterir; aynı işletmede birden fazla açık davet olabilir", async () => {
      await admin.post(`/platform/tenants/${A.tenant.id}/members`).send({ fullName: "Personel Bir", email: "p1@ornek.test", role: "STAFF" }).expect(201);
      await admin.post(`/platform/tenants/${A.tenant.id}/members`).send({ fullName: "Resepsiyon", email: "r1@ornek.test", role: "RECEPTION" }).expect(201);
      const p = await http().post("/auth/invite/preview").send({ token: inviteToken(lastMail("p1@ornek.test")!.text) }).expect(200);
      expect(p.body).toMatchObject({ salon: "Salon A", role: "STAFF" });
      expect(await su.tenantInvite.count({ where: { tenantId: A.tenant.id, status: "SENT" } })).toBe(2);
    });

    it("tekrar davet, mevcut üye, platform yöneticisi ve sahip rolü reddedilir", async () => {
      const r = await admin.post(`/platform/tenants/${A.tenant.id}/members`).send({ fullName: "Personel Bir", email: "P1@ornek.test", role: "STAFF" }).expect(409);
      expect(r.body.message).toMatch(/zaten açık bir davet/);
      await admin.post(`/platform/tenants/${A.tenant.id}/members`).send({ fullName: "Müdür", email: "mudur@ornek.test", role: "STAFF" }).expect(409);
      await admin.post(`/platform/tenants/${A.tenant.id}/members`).send({ fullName: "Admin", email: "admin@proguzellik.test", role: "STAFF" }).expect(409);
      await admin.post(`/platform/tenants/${A.tenant.id}/members`).send({ fullName: "Sahip", email: "yeni@ornek.test", role: "OWNER" }).expect(400);
      await admin.post(`/platform/tenants/${A.tenant.id}/members`).send({ fullName: "X", email: "gecersiz", role: "STAFF" }).expect(400);
      await admin.post("/platform/tenants/00000000-0000-4000-8000-000000000000/members").send({ fullName: "Yok", email: "yok@ornek.test", role: "STAFF" }).expect(404);
    });

    it("davet iptal edilince bağlantı çalışmaz; yeniden gönderim eski bağlantıyı geçersiz kılar", async () => {
      const inv = await su.tenantInvite.findFirstOrThrow({ where: { email: "r1@ornek.test" } });
      const old = inviteToken(lastMail("r1@ornek.test")!.text);
      await admin.post(`/platform/invites/${inv.id}/resend`).expect(200);
      const fresh = inviteToken(lastMail("r1@ornek.test")!.text);
      expect(fresh).not.toBe(old);
      await http().post("/auth/invite/preview").send({ token: old }).expect(400);
      await http().post("/auth/invite/preview").send({ token: fresh }).expect(200);
      await admin.post(`/platform/invites/${inv.id}/revoke`).expect(200);
      await http().post("/auth/invite/preview").send({ token: fresh }).expect(400);
      await admin.post(`/platform/invites/${inv.id}/revoke`).expect(409);
      expect(await su.auditLog.count({ where: { entityId: inv.id, action: "platform.invite_revoked" } })).toBe(1);
    });

    it("işletme başına tek açık SAHİP daveti kuralı korunur; çok sayıda ekip davetinde sahip daveti detayda kaybolmaz", async () => {
      await admin.post(`/platform/tenants/${B.tenant.id}/invite`).send({ fullName: "İkinci Sahip", email: "sahip2@ornek.test" }).expect(201);
      for (let i = 0; i < 11; i++) await admin.post(`/platform/tenants/${B.tenant.id}/members`).send({ fullName: `Personel ${i}`, email: `toplu${i}@ornek.test`, role: "STAFF" }).expect(201);
      const detail = await admin.get(`/platform/tenants/${B.tenant.id}`).expect(200);
      expect(detail.body.invites.filter((i: any) => i.role === "OWNER" && i.status === "SENT")).toHaveLength(1);
      expect(detail.body.invites.filter((i: any) => i.role === "STAFF")).toHaveLength(11);
      await admin.post(`/platform/tenants/${B.tenant.id}/invite`).send({ fullName: "Üçüncü Sahip", email: "sahip3@ornek.test" }).expect(409);
      await admin.post(`/platform/tenants/${B.tenant.id}/invite/revoke`).expect(200);
    });
  });

  describe("SMTP yokken (canlı + mock e-posta)", () => {
    const original = { NODE_ENV: env.NODE_ENV, EMAIL_MODE: env.EMAIL_MODE };
    afterEach(() => Object.assign(env, original));

    it("davet gönderilmiş gibi gösterilmez: bağlantı üretilmez, EMAIL_NOT_CONFIGURED döner", async () => {
      Object.assign(env, { NODE_ENV: "production", EMAIL_MODE: "mock" });
      const before = outbox.length;
      const r = await admin.post(`/platform/tenants/${B.tenant.id}/members`).send({ fullName: "Bekleyen", email: "bekle@ornek.test", role: "STAFF" }).expect(201);
      expect(r.body).toMatchObject({ status: "PENDING_DELIVERY", delivered: false, code: "EMAIL_NOT_CONFIGURED" });
      expect(r.body.reason).toMatch(/GÖNDERİLMEDİ/);
      expect(outbox.length).toBe(before);
      expect(await su.tenantInvite.findFirstOrThrow({ where: { email: "bekle@ornek.test" } })).toMatchObject({ tokenHash: null, sendCount: 0 });
    });

    it("parola sıfırlama 503 EMAIL_NOT_CONFIGURED döner; belirteç oluşmaz", async () => {
      Object.assign(env, { NODE_ENV: "production", EMAIL_MODE: "mock" });
      const before = outbox.length;
      const r = await admin.post(`/platform/users/${B.user.id}/password-reset`).send({}).expect(503);
      expect(r.body.code).toBe("EMAIL_NOT_CONFIGURED");
      expect(outbox.length).toBe(before);
      expect(await su.authToken.count({ where: { userId: B.user.id, type: "PASSWORD_RESET" } })).toBe(0);
      expect(await su.auditLog.count({ where: { entityId: B.user.id, action: "platform.user_password_reset_blocked" } })).toBe(1);
    });
  });

  describe("rol ve yetki düzenleme", () => {
    it("rol değişir, hemen etkili olur ve denetim kaydına önceki/yeni rolle yazılır", async () => {
      const m = await membershipOf(A.tenant.id, "mudur@ornek.test");
      const token = await login(app, "mudur@ornek.test", NEW_PASSWORD);
      await admin.patch(`/platform/memberships/${m.id}`).send({ role: "RECEPTION" }).expect(200);
      // Resepsiyon ekip yönetimine erişemez (oturum açıkken bile).
      await api(app, token, A.tenant.id).get("/team").expect(403);
      const log = await su.auditLog.findFirstOrThrow({ where: { entityId: m.id, action: "platform.member_role_changed" } });
      expect(log).toMatchObject({ tenantId: A.tenant.id, actorId: adminId, metadata: { from: "MANAGER", to: "RECEPTION" } });
      await admin.patch(`/platform/memberships/${m.id}`).send({ role: "RECEPTION" }).expect(409);
      await admin.patch(`/platform/memberships/${m.id}`).send({ role: "ADMIN" }).expect(400);
    });

    it("son aktif sahibin rolü değiştirilemez; ikinci sahip atanınca değiştirilebilir", async () => {
      const ownerM = await membershipOf(A.tenant.id, "a@test.local");
      const r = await admin.patch(`/platform/memberships/${ownerM.id}`).send({ role: "MANAGER" }).expect(409);
      expect(r.body.message).toMatch(/son aktif sahibi/);
      const m = await membershipOf(A.tenant.id, "mudur@ornek.test");
      await admin.patch(`/platform/memberships/${m.id}`).send({ role: "OWNER" }).expect(200);
      await admin.patch(`/platform/memberships/${ownerM.id}`).send({ role: "MANAGER" }).expect(200);
      await admin.patch(`/platform/memberships/${ownerM.id}`).send({ role: "OWNER" }).expect(200);
      await admin.patch(`/platform/memberships/${m.id}`).send({ role: "MANAGER" }).expect(200);
    });

    it("eşzamanlı iki sahip kaldırma isteğinde en az bir sahip kalır", async () => {
      const m = await membershipOf(A.tenant.id, "mudur@ornek.test");
      await admin.patch(`/platform/memberships/${m.id}`).send({ role: "OWNER" }).expect(200);
      const ownerM = await membershipOf(A.tenant.id, "a@test.local");
      const rs = await Promise.all([ownerM.id, m.id].map((id) => admin.post(`/platform/memberships/${id}/deactivate`).send({ reason: "eşzamanlı" })));
      expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await su.membership.count({ where: { tenantId: A.tenant.id, role: "OWNER", isActive: true } })).toBe(1);
      // Eski hâline getir
      const closed = rs[0].status === 200 ? ownerM.id : m.id;
      await admin.post(`/platform/memberships/${closed}/activate`).expect(200);
      await admin.patch(`/platform/memberships/${m.id}`).send({ role: "MANAGER" }).expect(200);
    });
  });

  describe("pasifleştirme", () => {
    it("işletme erişimi kapatılınca kullanıcı o işletmeye erişemez; açılınca erişir", async () => {
      const m = await membershipOf(A.tenant.id, "mudur@ornek.test");
      const token = await login(app, "mudur@ornek.test", NEW_PASSWORD);
      const logged = () => su.auditLog.count({ where: { entityId: m.id, action: { in: ["platform.member_deactivated", "platform.member_activated"] } } });
      const before = await logged();
      await admin.post(`/platform/memberships/${m.id}/deactivate`).send({ reason: "İzinli" }).expect(200);
      await api(app, token, A.tenant.id).get("/team").expect(403);
      await admin.post(`/platform/memberships/${m.id}/deactivate`).send({}).expect(409);
      await admin.post(`/platform/memberships/${m.id}/activate`).expect(200);
      await api(app, token, A.tenant.id).get("/team").expect(200);
      expect(await logged()).toBe(before + 2);
    });

    it("son aktif sahibin erişimi kapatılamaz", async () => {
      const ownerM = await membershipOf(B.tenant.id, "b@test.local");
      await admin.post(`/platform/memberships/${ownerM.id}/deactivate`).send({}).expect(409);
    });

    it("hesap pasifleştirilince açık oturumlar kapanır, giriş ve sıfırlama bağlantısı çalışmaz; aktifleştirilince giriş yapılır", async () => {
      const token = await login(app, "mudur@ornek.test", NEW_PASSWORD);
      const user = await su.user.findUniqueOrThrow({ where: { email: "mudur@ornek.test" } });
      await admin.post(`/platform/users/${user.id}/password-reset`).send({}).expect(200);
      const link = resetToken(lastMail("mudur@ornek.test")!.text);
      await admin.post(`/platform/users/${user.id}/deactivate`).send({}).expect(400);
      const r = await admin.post(`/platform/users/${user.id}/deactivate`).send({ reason: "İşten ayrıldı" }).expect(200);
      expect(r.body.revokedSessions).toBeGreaterThanOrEqual(1);
      await api(app, token, A.tenant.id).get("/team").expect(401);
      await http().post("/auth/login").send({ email: "mudur@ornek.test", password: NEW_PASSWORD }).expect(401);
      await http().post("/auth/reset-password").send({ token: link, newPassword: "BaskaParola2026" }).expect(400);
      expect((await admin.get("/platform/users?status=inactive").expect(200)).body.items.map((u: any) => u.email)).toEqual(["mudur@ornek.test"]);
      await admin.post(`/platform/users/${user.id}/deactivate`).send({ reason: "tekrar" }).expect(409);
      await admin.post(`/platform/users/${user.id}/password-reset`).send({}).expect(409);
      await admin.post(`/platform/users/${user.id}/activate`).expect(200);
      await login(app, "mudur@ornek.test", NEW_PASSWORD);
      const actions = (await su.auditLog.findMany({ where: { entityId: user.id } })).map((x) => x.action);
      expect(actions).toEqual(expect.arrayContaining(["platform.user_deactivated", "platform.user_activated"]));
    });

    it("platform yöneticisi, kendi hesabı ve aktif işletmenin tek sahibi pasifleştirilemez", async () => {
      await admin.post(`/platform/users/${adminId}/deactivate`).send({ reason: "kendim" }).expect(403);
      const r = await admin.post(`/platform/users/${B.user.id}/deactivate`).send({ reason: "deneme" }).expect(409);
      expect(r.body.message).toMatch(/Salon B işletmesinin tek aktif sahibi/);
      expect((await su.user.findUniqueOrThrow({ where: { id: B.user.id } })).isActive).toBe(true);
    });
  });

  describe("parola sıfırlama", () => {
    it("bağlantı yalnızca e-postayla gider; kullanılınca parola değişir ve oturumlar kapanır", async () => {
      const token = await login(app, "b@test.local");
      const r = await admin.post(`/platform/users/${B.user.id}/password-reset`).send({}).expect(200);
      expect(r.body).toEqual({ sent: true, revokedSessions: 0 });
      const link = resetToken(lastMail("b@test.local")!.text);
      expect(link.length).toBeGreaterThan(20);
      expect(JSON.stringify(await su.auditLog.findMany({ where: { entityId: B.user.id } }))).not.toContain(link);
      await http().post("/auth/reset-password").send({ token: link, newPassword: NEW_PASSWORD }).expect(200);
      await api(app, token, B.tenant.id).get("/customers").expect(401);
      await login(app, "b@test.local", NEW_PASSWORD);
      expect(await su.auditLog.count({ where: { entityId: B.user.id, action: "platform.user_password_reset_sent", actorId: adminId } })).toBe(1);
    });

    it("isteğe bağlı olarak oturumlar hemen kapatılır; yeni bağlantı öncekini geçersiz kılar", async () => {
      const token = await login(app, "b@test.local", NEW_PASSWORD);
      await admin.post(`/platform/users/${B.user.id}/password-reset`).send({}).expect(200);
      const first = resetToken(lastMail("b@test.local")!.text);
      const r = await admin.post(`/platform/users/${B.user.id}/password-reset`).send({ revokeSessions: true }).expect(200);
      expect(r.body.revokedSessions).toBeGreaterThanOrEqual(1);
      await api(app, token, B.tenant.id).get("/customers").expect(401);
      await http().post("/auth/reset-password").send({ token: first, newPassword: "BaskaParola2026" }).expect(400);
    });

    it("platform yöneticisinin parolası bu panelden sıfırlanamaz", async () => {
      await admin.post(`/platform/users/${adminId}/password-reset`).send({}).expect(403);
    });
  });

  describe("2FA sıfırlama", () => {
    const ADMIN = "admin@proguzellik.test";
    let C: Awaited<ReturnType<typeof createTenantWithUser>>;
    let D: Awaited<ReturnType<typeof createTenantWithUser>>;
    let cSecret: string;
    beforeAll(async () => {
      C = await createTenantWithUser(su, { name: "Salon C", email: "c@test.local" });
      D = await createTenantWithUser(su, { name: "Salon D", email: "d@test.local" });
      cSecret = (await enableMfa(app, "c@test.local")).secret;
      await enableMfa(app, "d@test.local");
    });

    it("yeniden doğrulama ve gerekçe zorunlu; yanlış parola/kod reddedilir ve kaydedilir", async () => {
      const url = `/platform/users/${C.user.id}/mfa-reset`;
      await admin.post(url).send({ reason: "Telefon kayboldu" }).expect(400);
      await admin.post(url).send({ password: TEST_PASSWORD, code: await freshTotp(ADMIN, adminSecret) }).expect(400);
      await admin.post(url).send({ password: "yanlis", code: await freshTotp(ADMIN, adminSecret), reason: "Telefon kayboldu" }).expect(401);
      await admin.post(url).send({ password: TEST_PASSWORD, code: "000000", reason: "Telefon kayboldu" }).expect(401);
      expect(await su.auditLog.count({ where: { actorId: adminId, action: "auth.reauth_failed" } })).toBeGreaterThanOrEqual(2);
      expect((await su.user.findUniqueOrThrow({ where: { id: C.user.id } })).mfaEnabledAt).not.toBeNull();
    });

    it("işletme sahibi başkasının 2FA'sını sıfırlayamaz", async () => {
      const c = api(app, await loginWithMfa(app, "c@test.local", cSecret), C.tenant.id);
      await c.post(`/platform/users/${D.user.id}/mfa-reset`).send({ password: TEST_PASSWORD, code: "123456", reason: "Telefon kayboldu" }).expect(403);
    });

    it("başarılı sıfırlama 2FA'yı ve kurtarma kodlarını siler, oturumları kapatır, denetim kaydı yazar; kod tekrar kullanılamaz", async () => {
      const cToken = await loginWithMfa(app, "c@test.local", cSecret);
      const code = await freshTotp(ADMIN, adminSecret);
      const r = await admin.post(`/platform/users/${C.user.id}/mfa-reset`).send({ password: TEST_PASSWORD, code, reason: "Telefon kayboldu" }).expect(200);
      expect(r.body).toMatchObject({ reset: true, notified: true });
      expect(r.body.revokedSessions).toBeGreaterThanOrEqual(1);
      const u = await su.user.findUniqueOrThrow({ where: { id: C.user.id } });
      expect(u.mfaEnabledAt).toBeNull();
      expect(u.mfaSecretEnc).toBeNull();
      expect(await su.recoveryCode.count({ where: { userId: C.user.id } })).toBe(0);
      await api(app, cToken, C.tenant.id).get("/customers").expect(401);
      const log = await su.auditLog.findFirstOrThrow({ where: { action: "platform.user_mfa_reset", entityId: C.user.id } });
      expect(log.actorId).toBe(adminId);
      expect(log.metadata).toMatchObject({ reason: "Telefon kayboldu" });
      expect(lastMail("c@test.local")!.subject).toBe("İki adımlı doğrulamanız sıfırlandı");
      // Aynı kodla ikinci hassas işlem yapılamaz
      await admin.post(`/platform/users/${D.user.id}/mfa-reset`).send({ password: TEST_PASSWORD, code, reason: "Telefon kayboldu" }).expect(401);
      // Giriş artık 2FA istemez
      await login(app, "c@test.local");
    });

    it("2FA'sı kapalı kullanıcı, platform yöneticisi ve kendi hesabı reddedilir", async () => {
      const body = async () => ({ password: TEST_PASSWORD, code: await freshTotp(ADMIN, adminSecret), reason: "Telefon kayboldu" });
      await admin.post(`/platform/users/${C.user.id}/mfa-reset`).send(await body()).expect(409);
      await admin.post(`/platform/users/${adminId}/mfa-reset`).send(await body()).expect(403);
    });
  });
});
