import { INestApplication, Logger } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { loadEnv } from "../src/config/env";
import { MockEmailProvider } from "../src/email/email.provider";
import { api, createApp, createTenantWithUser, enableMfa, login, owner, resetDb, TEST_PASSWORD } from "./helpers";

const linkToken = (text: string) => /davet\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";

describe("SaaS sahibi: işletme oluşturma, davet ve yönetim", () => {
  const su = owner();
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let outbox: MockEmailProvider["outbox"];
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  const logs: string[] = [];
  const http = () => request(app.getHttpServer());
  const env = loadEnv();
  const lastInviteToken = (to: string) => linkToken([...outbox].reverse().find((m) => m.to === to)?.text ?? "");

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    await su.user.create({
      data: { email: "admin@proguzellik.test", fullName: "Platform Sahibi", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true },
    });
    app = await createApp();
    // Tüm Nest log çıktısını yakala: belirteç hiçbir log satırına düşmemeli.
    for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(function (this: unknown, ...args: unknown[]) {
        logs.push(args.map(String).join(" "));
      });
    }
    outbox = app.get(MockEmailProvider).outbox;
    admin = api(app, (await enableMfa(app, "admin@proguzellik.test")).token);
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await su.$disconnect();
  });

  const newSalon = (over: Record<string, unknown> = {}) => ({
    name: "Gül Güzellik Merkezi",
    ownerName: "Gül Yılmaz",
    ownerEmail: "gul@ornek.test",
    planCode: "STARTER",
    trialDays: 14,
    ...over,
  });

  describe("yetki", () => {
    it("işletme sahibi ve oturumsuz istek platform uç noktalarına erişemez", async () => {
      const a = api(app, await login(app, "a@test.local"), A.tenant.id);
      await a.post("/platform/tenants").send(newSalon()).expect(403);
      await a.get("/platform/tenants").expect(403);
      await a.post(`/platform/tenants/${A.tenant.id}/suspend`).send({ reason: "deneme" }).expect(403);
      await http().post("/platform/tenants").send(newSalon()).expect(401);
      expect(await su.tenant.count()).toBe(1);
    });
  });

  describe("oluşturma ve davet", () => {
    let tenantId: string;

    it("işletmeyi deneme süresi ve paketle oluşturur, sahibe davet gönderir; yanıtta belirteç yok", async () => {
      const before = Date.now();
      const r = await admin.post("/platform/tenants").send(newSalon()).expect(201);
      tenantId = r.body.tenant.id;
      expect(r.body.tenant).toMatchObject({ name: "Gül Güzellik Merkezi", status: "TRIAL", planCode: "STARTER" });
      const trialMs = new Date(r.body.tenant.trialEndsAt).getTime() - before;
      expect(Math.round(trialMs / 86_400_000)).toBe(14);
      expect(r.body.invite).toMatchObject({ email: "gul@ornek.test", status: "SENT", delivered: true, role: "OWNER" });

      const token = lastInviteToken("gul@ornek.test");
      expect(token.length).toBeGreaterThan(20);
      const raw = JSON.stringify(r.body);
      expect(raw).not.toContain(token);
      expect(raw).not.toMatch(/tokenHash/);
      // Henüz kullanıcı ve üyelik yok; parola hiçbir yerde üretilmedi.
      expect(await su.user.findUnique({ where: { email: "gul@ornek.test" } })).toBeNull();
      expect(await su.membership.count({ where: { tenantId } })).toBe(0);
      // Veritabanında yalnızca özet var.
      const inv = await su.tenantInvite.findFirstOrThrow({ where: { tenantId } });
      expect(inv.tokenHash).not.toBe(token);
      expect(inv.tokenHash).toHaveLength(64);
      // Denetim kaydı
      const actions = (await su.auditLog.findMany({ where: { tenantId } })).map((x) => x.action);
      expect(actions).toEqual(expect.arrayContaining(["platform.tenant_created", "platform.invite_sent"]));
      expect(JSON.stringify(await su.auditLog.findMany({ where: { tenantId } }))).not.toContain(token);
    });

    it("liste, arama ve detayda belirteç veya özeti görünmez", async () => {
      const token = lastInviteToken("gul@ornek.test");
      const list = await admin.get("/platform/tenants?search=gül").expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ name: "Gül Güzellik Merkezi", openInvite: { email: "gul@ornek.test", status: "SENT" } });
      expect((await admin.get("/platform/tenants?search=bulunmayan").expect(200)).body).toHaveLength(0);
      expect((await admin.get("/platform/tenants?status=TRIAL").expect(200)).body.length).toBeGreaterThanOrEqual(1);
      const detail = await admin.get(`/platform/tenants/${tenantId}`).expect(200);
      expect(detail.body.invites[0]).toMatchObject({ email: "gul@ornek.test", status: "SENT", sendCount: 1 });
      for (const body of [list.body, detail.body, (await admin.get(`/platform/audit?tenantId=${tenantId}`).expect(200)).body]) {
        const raw = JSON.stringify(body);
        expect(raw).not.toContain(token);
        expect(raw).not.toMatch(/tokenHash/);
      }
    });

    it("davet önizlemesi yalnızca geçerli belirteçle çalışır", async () => {
      const token = lastInviteToken("gul@ornek.test");
      const p = await http().post("/auth/invite/preview").send({ token }).expect(200);
      expect(p.body).toEqual({ salon: "Gül Güzellik Merkezi", email: "gul@ornek.test", fullName: "Gül Yılmaz", existingAccount: false });
      await http().post("/auth/invite/preview").send({ token: "x".repeat(43) }).expect(400);
    });

    it("yeniden gönderim yeni belirteç üretir; eskisi geçersiz olur", async () => {
      const old = lastInviteToken("gul@ornek.test");
      const r = await admin.post(`/platform/tenants/${tenantId}/invite/resend`).expect(200);
      expect(r.body).toMatchObject({ status: "SENT", sendCount: 2, delivered: true });
      const fresh = lastInviteToken("gul@ornek.test");
      expect(fresh).not.toBe(old);
      await http().post("/auth/accept-invite").send({ token: old, password: "GulParola2026", kvkkAccepted: true }).expect(400);
    });

    it("zayıf parola reddedilir; davet kabul edilince sahip hesabı ve üyelik oluşur, oturum açılır", async () => {
      const token = lastInviteToken("gul@ornek.test");
      await http().post("/auth/accept-invite").send({ token, password: "kisa", kvkkAccepted: true }).expect(400);
      await http().post("/auth/accept-invite").send({ token, password: "GulParola2026" }).expect(400);
      const r = await http().post("/auth/accept-invite").send({ token, password: "GulParola2026", kvkkAccepted: true }).expect(200);
      expect(r.body.accepted).toBe(true);
      expect(r.body.accessToken).toBeTruthy();
      const user = await su.user.findUniqueOrThrow({ where: { email: "gul@ornek.test" } });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect(user.isPlatformAdmin).toBe(false);
      const m = await su.membership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId, userId: user.id } } });
      expect(m.role).toBe("OWNER");
      const inv = await su.tenantInvite.findFirstOrThrow({ where: { tenantId } });
      expect(inv).toMatchObject({ status: "ACCEPTED", tokenHash: null, acceptedUserId: user.id });
      expect(await su.auditLog.count({ where: { tenantId, action: "tenant.invite_accepted" } })).toBe(1);
    });

    it("belirteç ikinci kez kullanılamaz", async () => {
      const token = lastInviteToken("gul@ornek.test");
      await http().post("/auth/accept-invite").send({ token, password: "GulParola2026", kvkkAccepted: true }).expect(400);
      await http().post("/auth/invite/preview").send({ token }).expect(400);
    });

    it("yeni sahip yalnızca kendi işletmesini görür (kiracı yalıtımı) ve platform paneline erişemez", async () => {
      const g = api(app, await login(app, "gul@ornek.test", "GulParola2026"), tenantId);
      await g.get("/customers").expect(200);
      await api(app, await login(app, "gul@ornek.test", "GulParola2026"), A.tenant.id).get("/customers").expect(403);
      await g.get("/platform/tenants").expect(403);
    });

    it("süresi dolan davet kabul edilmez", async () => {
      const t = (await admin.post("/platform/tenants").send(newSalon({ name: "Süresi Dolan Salon", ownerEmail: "sure@ornek.test" })).expect(201)).body;
      const token = lastInviteToken("sure@ornek.test");
      await su.tenantInvite.updateMany({ where: { tenantId: t.tenant.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post("/auth/accept-invite").send({ token, password: "SureParola2026", kvkkAccepted: true }).expect(400);
      expect(await su.user.findUnique({ where: { email: "sure@ornek.test" } })).toBeNull();
    });

    it("iptal edilen davet kullanılamaz; ardından yeni sahip davet edilebilir, açık davet varken ikincisi reddedilir", async () => {
      const t = (await admin.post("/platform/tenants").send(newSalon({ name: "İptal Salonu", ownerEmail: "iptal@ornek.test" })).expect(201)).body;
      const token = lastInviteToken("iptal@ornek.test");
      await admin.post(`/platform/tenants/${t.tenant.id}/invite/revoke`).expect(200);
      await http().post("/auth/accept-invite").send({ token, password: "IptalParola2026", kvkkAccepted: true }).expect(400);
      await admin.post(`/platform/tenants/${t.tenant.id}/invite`).send({ fullName: "Yeni Sahip", email: "yeni-sahip@ornek.test" }).expect(201);
      await admin.post(`/platform/tenants/${t.tenant.id}/invite`).send({ fullName: "Bir Başka", email: "baska@ornek.test" }).expect(409);
      expect(await su.auditLog.count({ where: { tenantId: t.tenant.id, action: "platform.invite_revoked" } })).toBe(1);
    });

    it("mevcut hesabı olan kişi daveti yalnızca kendi parolasıyla kabul eder; oturum açılmaz (2FA atlanmaz)", async () => {
      const t = (await admin.post("/platform/tenants").send(newSalon({ name: "İkinci Şube", ownerEmail: "a@test.local" })).expect(201)).body;
      const token = lastInviteToken("a@test.local");
      expect((await http().post("/auth/invite/preview").send({ token }).expect(200)).body.existingAccount).toBe(true);
      await http().post("/auth/accept-invite").send({ token, password: "YanlisParola123", kvkkAccepted: true }).expect(401);
      const r = await http().post("/auth/accept-invite").send({ token, password: TEST_PASSWORD, kvkkAccepted: true }).expect(200);
      expect(r.body).toEqual({ accepted: true, loginRequired: true });
      const user = await su.user.findUniqueOrThrow({ where: { email: "a@test.local" } });
      expect(user.passwordHash).toBe(A.user.passwordHash);
      expect(await su.membership.count({ where: { userId: user.id } })).toBe(2);
      expect(t.tenant.id).not.toBe(A.tenant.id);
    });

    it("platform yöneticisi işletme sahibi olarak davet edilemez; geçersiz girdiler reddedilir", async () => {
      await admin.post("/platform/tenants").send(newSalon({ ownerEmail: "admin@proguzellik.test", name: "Yönetici Salonu" })).expect(409);
      await admin.post("/platform/tenants").send(newSalon({ planCode: "GOLD" })).expect(400);
      await admin.post("/platform/tenants").send(newSalon({ trialDays: 0 })).expect(400);
      await admin.post("/platform/tenants").send(newSalon({ trialDays: 61 })).expect(400);
      await admin.post("/platform/tenants").send(newSalon({ ownerEmail: "gecersiz" })).expect(400);
      expect(await su.tenant.count({ where: { name: "Yönetici Salonu" } })).toBe(0);
    });
  });

  describe("SMTP yokken (canlı + mock e-posta) davet bekletilir", () => {
    const original = { NODE_ENV: env.NODE_ENV, EMAIL_MODE: env.EMAIL_MODE };
    afterAll(() => Object.assign(env, original));

    it("belirteç üretilmez, e-posta gönderilmez, durum PENDING_DELIVERY; SMTP gelince gönderilir", async () => {
      Object.assign(env, { NODE_ENV: "production", EMAIL_MODE: "mock" });
      const sentBefore = outbox.length;
      const r = await admin.post("/platform/tenants").send(newSalon({ name: "Bekleyen Salon", ownerEmail: "bekle@ornek.test" })).expect(201);
      expect(r.body.invite).toMatchObject({ status: "PENDING_DELIVERY", delivered: false });
      expect(r.body.invite.reason).toMatch(/SMTP/);
      expect(outbox.length).toBe(sentBefore);
      const inv = await su.tenantInvite.findFirstOrThrow({ where: { tenantId: r.body.tenant.id } });
      expect(inv).toMatchObject({ status: "PENDING_DELIVERY", tokenHash: null, expiresAt: null, sendCount: 0 });
      expect(await su.auditLog.count({ where: { tenantId: r.body.tenant.id, action: "platform.invite_pending" } })).toBe(1);
      // Yeniden gönderim de bekler
      expect((await admin.post(`/platform/tenants/${r.body.tenant.id}/invite/resend`).expect(200)).body.status).toBe("PENDING_DELIVERY");

      // SMTP yapılandırıldı (testte mock sağlayıcı gönderir): yeniden gönderim bağlantıyı iletir.
      Object.assign(env, original);
      const r2 = await admin.post(`/platform/tenants/${r.body.tenant.id}/invite/resend`).expect(200);
      expect(r2.body).toMatchObject({ status: "SENT", delivered: true });
      expect(lastInviteToken("bekle@ornek.test").length).toBeGreaterThan(20);
    });

    it("canlıda e-posta gövdesi (bağlantı) veritabanına yazılmaz", async () => {
      Object.assign(env, { NODE_ENV: "production", EMAIL_MODE: "smtp" });
      try {
        // SMTP modunda sağlayıcı yine testte mock'tur; gövde kaydı canlı kuralına göre engellenir.
        const r = await admin.post("/platform/tenants").send(newSalon({ name: "Canlı Salon", ownerEmail: "canli@ornek.test" })).expect(201);
        expect(r.body.invite.status).toBe("SENT");
        const rec = await su.outboundEmail.findFirstOrThrow({ where: { to: "canli@ornek.test" } });
        expect(rec.body).toBeNull();
      } finally {
        Object.assign(env, original);
      }
    });

    it("gönderim başarısız olursa bağlantı geçersiz kılınır ve davet bekler", async () => {
      const r = await admin.post("/platform/tenants").send(newSalon({ name: "Hatalı Posta", ownerEmail: "sahip@fail.test" })).expect(201);
      expect(r.body.invite).toMatchObject({ status: "PENDING_DELIVERY", delivered: false });
      expect((await su.tenantInvite.findFirstOrThrow({ where: { tenantId: r.body.tenant.id } })).tokenHash).toBeNull();
    });
  });

  describe("paket, deneme süresi ve aktif/pasif", () => {
    let id: string;
    let ownerToken: string;
    beforeAll(async () => {
      id = A.tenant.id;
      ownerToken = await login(app, "a@test.local");
    });

    it("paket ve deneme bitiş tarihi güncellenir, denetim kaydı düşer", async () => {
      const end = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const r = await admin.patch(`/platform/tenants/${id}`).send({ planCode: "SMART", trialEndsAt: end }).expect(200);
      expect(r.body).toMatchObject({ planCode: "SMART" });
      expect(new Date(r.body.trialEndsAt).toISOString()).toBe(end);
      expect(await su.auditLog.count({ where: { tenantId: id, action: "platform.tenant_updated" } })).toBeGreaterThanOrEqual(1);
    });

    it("aktif personel sayısı yeni paketin sınırını aşıyorsa paket düşürülemez", async () => {
      const a = api(app, ownerToken, id);
      for (const n of ["P1", "P2", "P3", "P4"]) await a.post("/staff").send({ displayName: n, commissionRate: 0 }).expect(201);
      const r = await admin.patch(`/platform/tenants/${id}`).send({ planCode: "STARTER" }).expect(409);
      expect(r.body.message).toMatch(/4 aktif personel/);
      expect((await su.tenant.findUniqueOrThrow({ where: { id } })).planCode).toBe("SMART");
    });

    it("PATCH ile askıya alma yapılamaz; pasife alma gerekçe ister ve işletme erişimini keser", async () => {
      await admin.patch(`/platform/tenants/${id}`).send({ status: "SUSPENDED" }).expect(400);
      await admin.post(`/platform/tenants/${id}/suspend`).send({}).expect(400);
      const r = await admin.post(`/platform/tenants/${id}/suspend`).send({ reason: "Ödeme sorunu" }).expect(200);
      expect(r.body).toMatchObject({ status: "SUSPENDED", suspendedReason: "Ödeme sorunu" });
      await api(app, ownerToken, id).get("/customers").expect(403);
      await admin.post(`/platform/tenants/${id}/suspend`).send({ reason: "Tekrar" }).expect(409);
    });

    it("pasif işletme yeniden açılır ve önceki durumuna döner", async () => {
      const r = await admin.post(`/platform/tenants/${id}/reactivate`).expect(200);
      expect(r.body).toMatchObject({ status: "ACTIVE", suspendedAt: null, suspendedReason: null, suspendedFromStatus: null });
      await api(app, ownerToken, id).get("/customers").expect(200);
      const actions = (await su.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: "asc" } })).map((x) => x.action);
      expect(actions).toEqual(expect.arrayContaining(["platform.tenant_suspended", "platform.tenant_reactivated"]));
      await admin.post(`/platform/tenants/${id}/reactivate`).expect(409);
    });

    it("bilinmeyen işletme için 404", async () => {
      const ghost = "00000000-0000-4000-8000-000000000000";
      await admin.post(`/platform/tenants/${ghost}/suspend`).send({ reason: "yok" }).expect(404);
      await admin.post(`/platform/tenants/${ghost}/invite/resend`).expect(404);
      await admin.get(`/platform/tenants/${ghost}`).expect(404);
    });
  });

  it("hiçbir log satırında davet belirteci veya bağlantısı yok", () => {
    const tokens = outbox.filter((m) => m.subject.includes("davetiniz")).map((m) => linkToken(m.text));
    expect(tokens.length).toBeGreaterThan(3);
    const all = logs.join("\n");
    for (const t of tokens) expect(all).not.toContain(t);
    expect(all).not.toMatch(/davet\?token=/);
  });

  it("işletme rolü (RLS) davet tablosuna erişemez", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const tenantDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
    try {
      await expect(
        tenantDb.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.tenant_id', ${A.tenant.id}, true)`;
          return tx.tenantInvite.findMany();
        }),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await tenantDb.$disconnect();
    }
  });
});
