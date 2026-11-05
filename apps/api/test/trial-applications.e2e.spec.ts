import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { loadEnv, trialApplicationsEnabled } from "../src/config/env";
import { MockEmailProvider } from "../src/email/email.provider";
import { JobsService } from "../src/jobs/jobs.service";
import { api, createApp, createTenantWithUser, enableMfa, login, owner, resetDb, TEST_PASSWORD, testPhone } from "./helpers";

const DAY = 86_400_000;

describe("Deneme başvurusu (kayıt kapalıyken): başvuru → doğrulama → Owner onayı", () => {
  const su = owner();
  const env = loadEnv();
  const saved = { REGISTRATION_ENABLED: env.REGISTRATION_ENABLED, TRIAL_APPLICATIONS_ENABLED: env.TRIAL_APPLICATIONS_ENABLED, NODE_ENV: env.NODE_ENV, EMAIL_MODE: env.EMAIL_MODE };
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let outbox: MockEmailProvider["outbox"];
  const http = () => request(app.getHttpServer());
  const form = (o: Record<string, unknown> = {}) => ({
    businessName: "Lale Güzellik", fullName: "Lale Kaya", email: "lale@basvuru.test", phone: testPhone(), city: "İzmir", staffCount: 4, note: "Cuma arayın",
    kvkkAccepted: true, termsAccepted: true, ...o,
  });
  const verifyToken = (email: string) => {
    const m = [...outbox].reverse().find((x) => x.to === email.toLowerCase() && x.subject.startsWith("Deneme başvurunuz"));
    return /basvuru-dogrula\?token=([A-Za-z0-9_-]+)/.exec(m?.text ?? "")?.[1];
  };
  /** Başvuru + doğrulama; bekleyen başvurunun kimliğini döner. */
  const pendingApplication = async (o: Record<string, unknown> = {}) => {
    const body = form(o);
    await http().post("/auth/trial-applications").send(body).expect(202);
    await http().post("/auth/trial-applications/verify").send({ token: verifyToken(body.email as string) }).expect(200);
    return (await su.trialApplication.findFirstOrThrow({ where: { email: (body.email as string).toLowerCase(), status: "PENDING" } })).id;
  };
  const closedWithApplications = () => Object.assign(env, { REGISTRATION_ENABLED: "0", TRIAL_APPLICATIONS_ENABLED: "1" });

  beforeAll(async () => {
    await resetDb(su);
    await su.user.create({ data: { email: "admin@proguzellik.test", fullName: "Platform Sahibi", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true } });
    app = await createApp();
    outbox = app.get(MockEmailProvider).outbox;
    admin = api(app, (await enableMfa(app, "admin@proguzellik.test")).token);
  });
  beforeEach(closedWithApplications);
  afterEach(() => Object.assign(env, saved));
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  describe("bayrak", () => {
    it("bayrak kuralı: canlıda yalnız açıkça 1 ile ve yalnız kayıt kapalıyken", () => {
      const f = (NODE_ENV: string, REGISTRATION_ENABLED?: "0" | "1", TRIAL_APPLICATIONS_ENABLED?: "0" | "1") => trialApplicationsEnabled({ NODE_ENV, REGISTRATION_ENABLED, TRIAL_APPLICATIONS_ENABLED } as never);
      expect(f("production")).toBe(false);
      expect(f("production", undefined, "1")).toBe(true);
      expect(f("production", "0", "0")).toBe(false);
      expect(f("production", "1", "1")).toBe(false);
      expect(f("development", "0")).toBe(true);
      expect(f("development")).toBe(false); // geliştirmede kayıt varsayılan açık
    });

    it("canlıda tanımsızsa kapalı: gövde ne olursa olsun 403, kayıt bilgisinde applications=false", async () => {
      Object.assign(env, { NODE_ENV: "production", REGISTRATION_ENABLED: undefined, TRIAL_APPLICATIONS_ENABLED: undefined, EMAIL_MODE: "smtp" });
      await http().post("/auth/trial-applications").send({}).expect(403);
      await http().post("/auth/trial-applications").send(form()).expect(403);
      await http().post("/auth/trial-applications/verify").send({ token: "x".repeat(40) }).expect(403);
      expect((await http().get("/auth/registration").expect(200)).body).toEqual({ enabled: false, applications: false });
      expect(await su.trialApplication.count()).toBe(0);
    });

    it("kendi kendine kayıt açıkken başvuru formu kapalıdır", async () => {
      Object.assign(env, { REGISTRATION_ENABLED: "1", TRIAL_APPLICATIONS_ENABLED: "1" });
      await http().post("/auth/trial-applications").send(form()).expect(403);
      expect((await http().get("/auth/registration").expect(200)).body).toEqual({ enabled: true, applications: false });
    });

    it("canlıda SMTP yoksa hiçbir şey yazılmadan 503", async () => {
      Object.assign(env, { NODE_ENV: "production", EMAIL_MODE: "mock" });
      const r = await http().post("/auth/trial-applications").send(form({ email: "smtpyok@basvuru.test" })).expect(503);
      expect(r.body.code).toBe("EMAIL_NOT_CONFIGURED");
      expect(await su.trialApplication.count({ where: { email: "smtpyok@basvuru.test" } })).toBe(0);
    });
  });

  describe("başvuru ve doğrulama", () => {
    it("doğrulanmamış başvuru Owner listesinde görünmez; doğrulanınca bekler ve SaaS sahibine bildirim gider", async () => {
      const r = await http().post("/auth/trial-applications").send(form({ email: "Yeni@Basvuru.test", planCode: "STARTER" })).expect(202);
      expect(r.body).toEqual({ status: "VERIFICATION_SENT", email: "yeni@basvuru.test", expiresInHours: 48 });
      expect(JSON.stringify(r.body)).not.toMatch(/token/i);
      const row = await su.trialApplication.findFirstOrThrow({ where: { email: "yeni@basvuru.test" } });
      expect(row.status).toBe("UNVERIFIED");
      expect(row.tokenHash).toHaveLength(64);
      expect(row.planCode).toBe("STARTER");
      expect(await su.user.count({ where: { email: "yeni@basvuru.test" } })).toBe(0);
      expect(await su.tenant.count({ where: { name: "Lale Güzellik" } })).toBe(0);

      let list = await admin.get("/platform/trial-applications").expect(200);
      expect(list.body.items.find((a: { id: string }) => a.id === row.id)).toBeUndefined();

      const token = verifyToken("yeni@basvuru.test")!;
      await http().post("/auth/trial-applications/verify").send({ token }).expect(200, { status: "PENDING" });
      await http().post("/auth/trial-applications/verify").send({ token }).expect(400); // tek kullanımlık

      list = await admin.get("/platform/trial-applications?status=PENDING").expect(200);
      const item = list.body.items.find((a: { id: string }) => a.id === row.id);
      expect(item).toMatchObject({ businessName: "Lale Güzellik", fullName: "Lale Kaya", email: "yeni@basvuru.test", city: "İzmir", staffCount: 4, note: "Cuma arayın", status: "PENDING", warnings: [] });
      expect(item.phone).toMatch(/^\+90\d{10}$/);
      expect(JSON.stringify(list.body)).not.toMatch(/tokenHash|userAgent/);
      expect(list.body.counts.PENDING).toBeGreaterThanOrEqual(1);

      const note = outbox.find((m) => m.subject === "Yeni deneme başvurusu: Lale Güzellik");
      expect(note?.to).toBe(env.SUPPORT_EMAIL);
      expect(note?.text).not.toMatch(/token=/);
      expect(await su.auditLog.count({ where: { entityId: row.id, action: { in: ["trial_application.submitted", "trial_application.verified"] } } })).toBe(2);
    });

    it("bal küpü dolu istek sessizce yok sayılır", async () => {
      await http().post("/auth/trial-applications").send(form({ email: "bot@basvuru.test", hp: "http://spam" })).expect(202);
      expect(await su.trialApplication.count({ where: { email: "bot@basvuru.test" } })).toBe(0);
      expect(outbox.some((m) => m.to === "bot@basvuru.test")).toBe(false);
      expect(await su.auditLog.count({ where: { action: "trial_application.honeypot" } })).toBe(1);
    });

    it("hesabı olan e-posta sızdırılmaz: aynı yanıt, başvuru yazılmaz, sahibine bilgi gider", async () => {
      await createTenantWithUser(su, { name: "Var Olan", email: "varolan@basvuru.test" });
      const r = await http().post("/auth/trial-applications").send(form({ email: "varolan@basvuru.test" })).expect(202);
      expect(r.body.status).toBe("VERIFICATION_SENT");
      expect(await su.trialApplication.count({ where: { email: "varolan@basvuru.test" } })).toBe(0);
      expect(outbox.some((m) => m.to === "varolan@basvuru.test" && m.subject === "ProGüzellik hesabınız zaten var")).toBe(true);
    });

    it("aynı e-postayla yeni başvuru tek kayıt tutar ve önceki bağlantıyı geçersiz kılar", async () => {
      await http().post("/auth/trial-applications").send(form({ email: "iki@basvuru.test" })).expect(202);
      const first = verifyToken("iki@basvuru.test");
      await http().post("/auth/trial-applications").send(form({ email: "iki@basvuru.test", businessName: "İkinci Ad" })).expect(202);
      expect(await su.trialApplication.count({ where: { email: "iki@basvuru.test" } })).toBe(1);
      await http().post("/auth/trial-applications/verify").send({ token: first }).expect(400);
      await http().post("/auth/trial-applications/verify").send({ token: verifyToken("iki@basvuru.test") }).expect(200);
      // Onay bekleyen başvuru yeni istekle değişmez
      await http().post("/auth/trial-applications").send(form({ email: "iki@basvuru.test", businessName: "Üçüncü Ad" })).expect(202);
      expect((await su.trialApplication.findFirstOrThrow({ where: { email: "iki@basvuru.test" } })).businessName).toBe("İkinci Ad");
    });

    it("geçersiz form alanları ve onaysız KVKK reddedilir", async () => {
      await http().post("/auth/trial-applications").send(form({ email: "kvkk@basvuru.test", kvkkAccepted: false })).expect(400);
      await http().post("/auth/trial-applications").send(form({ email: "tel@basvuru.test", phone: "0632 123 45 67" })).expect(400);
      await http().post("/auth/trial-applications").send(form({ email: "per@basvuru.test", staffCount: 0 })).expect(400);
      expect(await su.trialApplication.count({ where: { email: { in: ["kvkk@basvuru.test", "tel@basvuru.test", "per@basvuru.test"] } } })).toBe(0);
    });

    it("süresi dolmuş bağlantı reddedilir; günlük görev doğrulanmamış ve eski reddedilmiş başvuruları siler", async () => {
      await http().post("/auth/trial-applications").send(form({ email: "gec@basvuru.test" })).expect(202);
      await su.trialApplication.updateMany({ where: { email: "gec@basvuru.test" }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post("/auth/trial-applications/verify").send({ token: verifyToken("gec@basvuru.test") }).expect(400);

      const oldRejected = await pendingApplication({ email: "eskiret@basvuru.test" });
      await admin.post(`/platform/trial-applications/${oldRejected}/reject`).send({ reason: "Test reddi" }).expect(200);
      await su.trialApplication.update({ where: { id: oldRejected }, data: { decidedAt: new Date(Date.now() - 31 * DAY) } });

      const r = await app.get(JobsService).runDaily({ force: true });
      expect(r.result).toMatchObject({ expiredApplications: 1, purgedRejectedApplications: 1 });
      expect(await su.trialApplication.count({ where: { email: { in: ["gec@basvuru.test", "eskiret@basvuru.test"] } } })).toBe(0);
    });

    it("işletme veritabanı rolü başvuru tablosuna erişemez", async () => {
      const tenantDb = new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });
      try {
        await expect(tenantDb.$queryRaw`SELECT * FROM "TrialApplication"`).rejects.toThrow(/permission denied/i);
      } finally {
        await tenantDb.$disconnect();
      }
    });
  });

  describe("SaaS sahibi kararı", () => {
    it("yalnızca platform yöneticisi listeler ve karar verir", async () => {
      const id = await pendingApplication({ email: "yetki@basvuru.test" });
      const A = await createTenantWithUser(su, { name: "Salon Yetki", email: "sahip-yetki@basvuru.test" });
      const a = api(app, await login(app, "sahip-yetki@basvuru.test"), A.tenant.id);
      await a.get("/platform/trial-applications").expect(403);
      await a.post(`/platform/trial-applications/${id}/approve`).send({ name: "X Salon", ownerName: "X Kişi", ownerEmail: "x@basvuru.test" }).expect(403);
      await http().get("/platform/trial-applications").expect(401);
      expect((await su.trialApplication.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");
    });

    it("onay: işletme 14 gün denemede açılır, sahibine davet gider, başvuru işletmeye bağlanır ve denetlenir", async () => {
      const id = await pendingApplication({ email: "onay@basvuru.test", businessName: "Papatya Salon", fullName: "Papatya Er", planCode: "STARTER" });
      const r = await admin
        .post(`/platform/trial-applications/${id}/approve`)
        .send({ name: "Papatya Güzellik", ownerName: "Papatya Er", ownerEmail: "onay@basvuru.test", planCode: "STARTER", trialDays: 14 })
        .expect(200);
      expect(r.body.invite.delivered).toBe(true);
      expect(r.body.application).toMatchObject({ status: "APPROVED", tenantId: r.body.tenant.id });
      const t = await su.tenant.findUniqueOrThrow({ where: { id: r.body.tenant.id } });
      expect(t).toMatchObject({ name: "Papatya Güzellik", status: "TRIAL", planCode: "STARTER", email: "onay@basvuru.test" });
      expect((t.trialEndsAt!.getTime() - Date.now()) / DAY).toBeGreaterThan(13.99);
      const inv = await su.tenantInvite.findFirstOrThrow({ where: { tenantId: t.id } });
      expect(inv).toMatchObject({ role: "OWNER", status: "SENT", email: "onay@basvuru.test", fullName: "Papatya Er" });
      expect(outbox.some((m) => m.to === "onay@basvuru.test" && /davet\?token=/.test(m.text))).toBe(true);
      const audit = await su.auditLog.findFirstOrThrow({ where: { action: "platform.trial_application_approved", entityId: id } });
      expect(audit.tenantId).toBe(t.id);
      expect(audit.metadata).toMatchObject({ edited: ["name"] });
      // Sahip daveti kabul edince başvurudaki onaylar kullanıcıya bağlanır
      const link = [...outbox].reverse().find((m) => m.to === "onay@basvuru.test" && /davet\?token=/.test(m.text))!.text;
      const token = /davet\?token=([A-Za-z0-9_-]+)/.exec(link)![1];
      const acc = await http().post("/auth/accept-invite").send({ token, password: TEST_PASSWORD, kvkkAccepted: true }).expect(200);
      const userId = acc.body.user.id;
      const consents = await su.userConsent.findMany({ where: { userId }, orderBy: { type: "asc" } });
      expect(consents.map((c) => [c.type, c.granted])).toEqual([["KVKK_NOTICE", true], ["TERMS", true], ["MARKETING", false]]);
      expect(consents[1].version).toMatch(/^\/kullanim-kosullari@/);
      // İkinci karar verilemez
      await admin.post(`/platform/trial-applications/${id}/approve`).send({ name: "Papatya Güzellik", ownerName: "Papatya Er", ownerEmail: "onay@basvuru.test" }).expect(409);
      await admin.post(`/platform/trial-applications/${id}/reject`).send({ reason: "geç" }).expect(409);
    });

    it("eşzamanlı iki onaydan yalnızca biri işletme açar", async () => {
      const id = await pendingApplication({ email: "yaris@basvuru.test", businessName: "Yarış Salon" });
      const body = { name: "Yarış Salon", ownerName: "Lale Kaya", ownerEmail: "yaris@basvuru.test" };
      const [x, y] = await Promise.all([admin.post(`/platform/trial-applications/${id}/approve`).send(body), admin.post(`/platform/trial-applications/${id}/approve`).send(body)]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      expect(await su.tenant.count({ where: { email: "yaris@basvuru.test" } })).toBe(1);
      expect(await su.tenantInvite.count({ where: { email: "yaris@basvuru.test" } })).toBe(1);
    });

    it("aynı telefonla açık işletme varsa uyarı gösterilir; onay için açık teyit gerekir", async () => {
      const phone = testPhone();
      const first = await pendingApplication({ email: "tel1@basvuru.test", phone, businessName: "Tel Bir" });
      await admin.post(`/platform/trial-applications/${first}/approve`).send({ name: "Tel Bir", ownerName: "Lale Kaya", ownerEmail: "tel1@basvuru.test" }).expect(200);
      const second = await pendingApplication({ email: "tel2@basvuru.test", phone, businessName: "Tel İki" });
      const g = await admin.get(`/platform/trial-applications/${second}`).expect(200);
      expect(g.body.warnings.join(" ")).toMatch(/Aynı telefonla açık işletme var: Tel Bir/);
      const body = { name: "Tel İki", ownerName: "Lale Kaya", ownerEmail: "tel2@basvuru.test" };
      const c = await admin.post(`/platform/trial-applications/${second}/approve`).send(body).expect(409);
      expect(c.body.code).toBe("APPLICATION_WARNINGS");
      expect((await su.trialApplication.findUniqueOrThrow({ where: { id: second } })).status).toBe("PENDING");
      await admin.post(`/platform/trial-applications/${second}/approve`).send({ ...body, ignoreWarnings: true }).expect(200);
    });

    it("işletme oluşturma başarısızsa başvuru beklemede kalır", async () => {
      const id = await pendingApplication({ email: "hata@basvuru.test" });
      await admin.post(`/platform/trial-applications/${id}/approve`).send({ name: "Hata Salon", ownerName: "Lale Kaya", ownerEmail: "admin@proguzellik.test" }).expect(409);
      const row = await su.trialApplication.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ status: "PENDING", tenantId: null, decidedAt: null });
    });

    it("ret: gerekçe zorunlu, başvurana e-posta gitmez, denetlenir", async () => {
      const id = await pendingApplication({ email: "ret@basvuru.test" });
      await admin.post(`/platform/trial-applications/${id}/reject`).send({ reason: "" }).expect(400);
      const before = outbox.filter((m) => m.to === "ret@basvuru.test").length;
      const r = await admin.post(`/platform/trial-applications/${id}/reject`).send({ reason: "Salon bilgileri doğrulanamadı" }).expect(200);
      expect(r.body).toMatchObject({ status: "REJECTED", rejectReason: "Salon bilgileri doğrulanamadı" });
      expect(outbox.filter((m) => m.to === "ret@basvuru.test").length).toBe(before);
      expect(await su.auditLog.count({ where: { action: "platform.trial_application_rejected", entityId: id } })).toBe(1);
      expect(await su.tenant.count({ where: { email: "ret@basvuru.test" } })).toBe(0);
    });

    it("bilinmeyen başvuru 404", async () => {
      await admin.get("/platform/trial-applications/00000000-0000-4000-8000-000000000000").expect(404);
      await admin.post("/platform/trial-applications/00000000-0000-4000-8000-000000000000/reject").send({ reason: "yok" }).expect(404);
    });
  });
});
