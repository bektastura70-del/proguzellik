import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { loadEnv } from "../src/config/env";
import { MockEmailProvider } from "../src/email/email.provider";
import { render } from "../src/email/templates";
import { JobsService } from "../src/jobs/jobs.service";
import { api, createApp, createTenantWithUser, enableMfa, login, owner, resetDb, TEST_PASSWORD } from "./helpers";

const DAY = 86_400_000;
const rid = () => randomUUID();

describe("E-posta şablonları (birim)", () => {
  it("özelleştirilmiş metin HTML olarak kaçışlanır, değişkenler doldurulur", () => {
    const r = render({ name: "trial_ending", vars: { salon: "<b>Salon</b>", days: 3, link: "https://x.test/p" } }, { subject: "{salon}: {days} gün", body: "Merhaba <script>x</script> {salon}\nSon {days} gün" });
    expect(r.subject).toBe("<b>Salon</b>: 3 gün");
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;b&gt;Salon&lt;/b&gt;");
    expect(r.text).toContain("Son 3 gün");
  });

  it("güvenlik e-postalarına özelleştirme uygulanmaz", () => {
    const r = render({ name: "password_reset", vars: { fullName: "A", link: "https://x.test/sifre?token=abc", minutes: 30 } }, { subject: "Sahte", body: "Bağlantı yok" });
    expect(r.subject).not.toBe("Sahte");
    expect(r.text).toContain("token=abc");
  });
});

describe("SaaS sahibi e-posta merkezi", () => {
  const su = owner();
  const env = loadEnv();
  let app: INestApplication;
  let admin: ReturnType<typeof api>;
  let outbox: MockEmailProvider["outbox"];
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let B: Awaited<ReturnType<typeof createTenantWithUser>>;
  const inProduction = async (fn: () => Promise<void>) => {
    const saved = { NODE_ENV: env.NODE_ENV, EMAIL_MODE: env.EMAIL_MODE };
    Object.assign(env, { NODE_ENV: "production", EMAIL_MODE: "mock" });
    try {
      await fn();
    } finally {
      Object.assign(env, saved);
    }
  };

  beforeAll(async () => {
    await resetDb(su);
    await su.emailTemplateOverride.deleteMany();
    await su.platformCompany.deleteMany();
    A = await createTenantWithUser(su, { name: "Salon A", email: "a@test.local" });
    B = await createTenantWithUser(su, { name: "Salon B", email: "b@test.local", status: "TRIAL" });
    await su.user.create({ data: { email: "admin@proguzellik.test", fullName: "Sahip", passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), isPlatformAdmin: true } });
    app = await createApp();
    outbox = app.get(MockEmailProvider).outbox;
    admin = api(app, (await enableMfa(app, "admin@proguzellik.test")).token);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("işletme kullanıcıları e-posta merkezine erişemez", async () => {
    const a = api(app, await login(app, "a@test.local"), A.tenant.id);
    for (const p of ["/platform/emails", "/platform/email-templates"]) await a.get(p).expect(403);
    await a.post("/platform/emails/notice").send({ subject: "Duyuru", body: "Bakım çalışması", serviceNoticeConfirmed: true, requestId: rid() }).expect(403);
    await request(app.getHttpServer()).get("/platform/emails").expect(401);
  });

  it("canlıda SMTP yoksa gönderilmiş sayılmaz: kayıt NOT_CONFIGURED, toplu bildirim 503", async () => {
    await inProduction(async () => {
      const before = outbox.length;
      const r = await admin.post("/platform/emails/notice").send({ subject: "Bakım", body: "Pazar 02:00 bakım var.", serviceNoticeConfirmed: true, requestId: rid() }).expect(503);
      expect(r.body.code).toBe("EMAIL_NOT_CONFIGURED");
      const pw = await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: "a@test.local" });
      expect(pw.status).toBeLessThan(500);
      expect(outbox.length).toBe(before);
      const h = await admin.get("/platform/emails?status=NOT_CONFIGURED").expect(200);
      expect(h.body.delivery.configured).toBe(false);
      expect(h.body.items.length).toBeGreaterThanOrEqual(1);
      expect(h.body.items[0]).not.toHaveProperty("body");
      expect(h.body.items[0]).not.toHaveProperty("payload");
    });
  });

  it("geçmiş: gövde/değişken dışarı verilmez; tek kullanımlık bağlantılı e-posta yeniden denenmez", async () => {
    const h = await admin.get("/platform/emails?template=password_reset").expect(200);
    const rec = h.body.items[0];
    expect(rec).toMatchObject({ template: "password_reset", retryable: false });
    await admin.post(`/platform/emails/${rec.id}/retry`).expect(409);
  });

  it("başarısız gönderim tekrar denenir; gönderilmiş e-posta tekrar denenmez", async () => {
    const fail = await createTenantWithUser(su, { name: "Hatalı", email: "sahip@fail.test" });
    const r = await admin.post("/platform/emails/notice").send({ tenantIds: [fail.tenant.id], subject: "Bilgi", body: "Hizmet bilgilendirmesi.", serviceNoticeConfirmed: true, requestId: rid() }).expect(201);
    expect(r.body).toMatchObject({ recipients: 1, sent: 0, failed: 1 });
    const rec = await su.outboundEmail.findFirstOrThrow({ where: { to: "sahip@fail.test", template: "owner_notice" } });
    expect(rec.status).toBe("FAILED");
    // Adres düzeltilemez; aynı adrese yeniden deneme yine başarısız olur ve deneme sayısı artar
    await admin.post(`/platform/emails/${rec.id}/retry`).expect(503);
    expect((await su.outboundEmail.findUniqueOrThrow({ where: { id: rec.id } })).attempts).toBe(2);
    // Sağlayıcı düzelince (simülasyon: alıcı adresi düzeltilmiş kayıt) gönderilir, sonra tekrar denenemez
    await su.outboundEmail.update({ where: { id: rec.id }, data: { to: "sahip@ok.test" } });
    const ok = await admin.post(`/platform/emails/${rec.id}/retry`).expect(200);
    expect(ok.body.sent).toBe(true);
    expect(outbox.some((m) => m.to === "sahip@ok.test" && m.subject === "Bilgi")).toBe(true);
    await admin.post(`/platform/emails/${rec.id}/retry`).expect(409);
    expect(await su.auditLog.count({ where: { action: "platform.email_retried", entityId: rec.id } })).toBe(2);
  });

  it("toplu bilgilendirme yalnızca seçili durumdaki aktif sahiplere gider; aynı istek tekrar gönderilmez", async () => {
    const requestId = rid();
    const body = { statuses: ["TRIAL"], subject: "Deneme kullanıcılarına", body: "Yeni rapor ekranı açıldı.", serviceNoticeConfirmed: true, requestId };
    const r = await admin.post("/platform/emails/notice").send(body).expect(201);
    expect(r.body).toMatchObject({ recipients: 1, sent: 1 });
    expect(outbox.filter((m) => m.subject === "Deneme kullanıcılarına").map((m) => m.to)).toEqual(["b@test.local"]);
    const again = await admin.post("/platform/emails/notice").send(body).expect(201);
    expect(again.body).toMatchObject({ sent: 0, skipped: 1 });
    await admin.post("/platform/emails/notice").send({ ...body, requestId: rid(), serviceNoticeConfirmed: false }).expect(400);
    await admin.post("/platform/emails/notice").send({ ...body, requestId: rid(), tenantIds: [A.tenant.id] }).expect(400);
    await admin.post("/platform/emails/notice").send({ subject: "X yok", body: "Bulunamayan işletme", tenantIds: [rid()], serviceNoticeConfirmed: true, requestId: rid() }).expect(404);
    expect(await su.auditLog.count({ where: { action: "platform.notice_sent" } })).toBeGreaterThanOrEqual(2);
  });

  it("şablon düzenleme: bilinmeyen değişken reddedilir, güvenlik şablonu düzenlenemez, sıfırlanır", async () => {
    const list = await admin.get("/platform/email-templates").expect(200);
    const trial = list.body.find((t: { name: string }) => t.name === "trial_ending");
    expect(trial).toMatchObject({ editable: true, customized: false });
    expect(list.body.find((t: { name: string }) => t.name === "password_reset")).toMatchObject({ editable: false, secret: true });
    await admin.put("/platform/email-templates/password_reset").send({ subject: "Yeni konu", body: "Yeni gövde metni" }).expect(409);
    await admin.put("/platform/email-templates/trial_ending").send({ subject: "{salon} {token}", body: "Gövde metni burada" }).expect(400);
    await admin.put("/platform/email-templates/yok").send({ subject: "Konu", body: "Gövde metni burada" }).expect(404);
    await admin.put("/platform/email-templates/trial_ending").send({ subject: "Bitiş: {days} gün", body: "{salon} denemeniz yakında bitiyor." }).expect(200);
    const p = await admin.post("/platform/email-templates/trial_ending/preview").send({}).expect(200);
    expect(p.body.subject).toBe("Bitiş: 3 gün");
    // Gerçek gönderimde de özelleştirme kullanılır
    await su.tenant.update({ where: { id: B.tenant.id }, data: { trialEndsAt: new Date(Date.now() + 2 * DAY) } });
    await app.get(JobsService).runDaily({ force: true });
    expect(outbox.some((m) => m.to === "b@test.local" && m.subject === "Bitiş: 2 gün")).toBe(true);
    await admin.delete("/platform/email-templates/trial_ending").expect(200);
    expect((await admin.get("/platform/email-templates").expect(200)).body.find((t: { name: string }) => t.name === "trial_ending").customized).toBe(false);
    expect(await su.auditLog.count({ where: { action: { in: ["platform.email_template_updated", "platform.email_template_reset"] } } })).toBe(2);
  });

  it("ödeme hatırlatması ve fatura bildirimi; taslak fatura bildirilmez", async () => {
    const acc = (await admin.post("/platform/finance/entries").send({ tenantId: A.tenant.id, type: "ACCRUAL", amount: 1250.5, description: "Kasım aboneliği", dueDate: new Date(Date.now() - 2 * DAY).toISOString(), requestId: rid() }).expect(201)).body.id;
    const r = await admin.post(`/platform/finance/entries/${acc}/remind`).expect(200);
    expect(r.body).toMatchObject({ sent: true, to: "a@test.local" });
    expect(outbox.some((m) => m.to === "a@test.local" && m.subject === "Ödeme hatırlatması" && m.text.includes("1.250,50"))).toBe(true);
    await admin.post("/platform/finance/entries").send({ tenantId: A.tenant.id, type: "PAYMENT", amount: 1250.5, description: "Havale", method: "BANK_TRANSFER", relatedEntryId: acc, requestId: rid() }).expect(201);
    await admin.post(`/platform/finance/entries/${acc}/remind`).expect(409);

    await admin.put("/platform/company").send({ legalName: "Pro Güzellik Test", taxNumber: "1234567890", taxOffice: "Kadıköy", address: "İstanbul", vatRate: 20, pricesIncludeVat: true }).expect(200);
    await admin.put(`/platform/tenants/${A.tenant.id}/billing-profile`).send({ legalName: "Salon A Ltd.", taxNumber: "9876543210", taxOffice: "Beşiktaş", address: "İstanbul", email: "muhasebe@salona.test" }).expect(200);
    const acc2 = (await admin.post("/platform/finance/entries").send({ tenantId: A.tenant.id, type: "ACCRUAL", amount: 1000, description: "Aralık aboneliği", requestId: rid() }).expect(201)).body.id;
    const inv = (await admin.post("/platform/invoices").send({ tenantId: A.tenant.id, accrualId: acc2 }).expect(201)).body;
    await admin.post(`/platform/invoices/${inv.id}/notify`).expect(409);
    await admin.post(`/platform/invoices/${inv.id}/record`).send({ officialNumber: "ABC2026000000099", issueDate: new Date().toISOString() }).expect(200);
    const n = await admin.post(`/platform/invoices/${inv.id}/notify`).expect(200);
    expect(n.body).toMatchObject({ sent: true, to: "muhasebe@salona.test" });
    expect(outbox.some((m) => m.to === "muhasebe@salona.test" && m.text.includes("ABC2026000000099"))).toBe(true);

    await inProduction(async () => {
      const x = await admin.post(`/platform/invoices/${inv.id}/notify`).expect(503);
      expect(x.body.code).toBe("EMAIL_NOT_CONFIGURED");
    });
  });

  it("günlük görev vadesi geçen açık tahakkuka haftada bir hatırlatır", async () => {
    const jobs = app.get(JobsService);
    const now = new Date("2031-01-10T09:00:00Z");
    const acc = (await admin.post("/platform/finance/entries").send({ tenantId: A.tenant.id, type: "ACCRUAL", amount: 300, description: "Ocak aboneliği", dueDate: new Date(now.getTime() - DAY).toISOString(), requestId: rid() }).expect(201)).body.id;
    const count = () => su.outboundEmail.count({ where: { template: "payment_reminder", dedupeKey: { startsWith: `payment-reminder:auto:${acc}:` } } });
    await jobs.runDaily({ now });
    await jobs.runDaily({ now: new Date(now.getTime() + 2 * DAY) });
    expect(await count()).toBe(1);
    await jobs.runDaily({ now: new Date(now.getTime() + 7 * DAY) });
    expect(await count()).toBe(2);
  });

  it("manuel abonelik tanımlanınca işletmeye bilgi verilir (ücretsiz ise belirtilir)", async () => {
    const r = await admin.post(`/platform/tenants/${B.tenant.id}/subscriptions`).send({ planCode: "PROFESSIONAL", billingCycle: "MONTHLY", complimentary: true, note: "Açılış hediyesi", requestId: rid() });
    expect(r.status).toBeLessThan(300);
    const m = [...outbox].reverse().find((x) => x.to === "b@test.local" && x.subject === "Aboneliğiniz başladı");
    expect(m?.text).toMatch(/ücretsiz/);
  });
});
