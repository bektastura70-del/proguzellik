import { INestApplication } from "@nestjs/common";
import { MockPaymentProvider, PaymentProvider } from "../src/billing/payment-provider";
import { addPeriod } from "../src/billing/subscriptions.service";
import { productionIssues, loadEnv } from "../src/config/env";
import { MockEmailProvider } from "../src/email/email.provider";
import { JobsService } from "../src/jobs/jobs.service";
import { createApp, createTenantWithUser, owner, resetDb } from "./helpers";

const DAY = 86_400_000;

describe("Günlük abonelik görevi (deneme, yenileme, gecikme, iptal, paket sınırı)", () => {
  const su = owner();
  let app: INestApplication;
  let jobs: JobsService;
  let pay: MockPaymentProvider;
  let mail: MockEmailProvider;
  const now = new Date("2030-03-10T09:00:00Z");
  let day = 0;
  /** Her çalıştırma farklı güne düşsün diye "şimdi" ilerletilir. */
  const run = (opts: { force?: boolean; at?: Date } = {}) => jobs.runDaily({ now: opts.at ?? new Date(now.getTime() + day++ * DAY), force: opts.force });

  async function tenantWithSub(name: string, o: { token: string; cancelAtPeriodEnd?: boolean; periodEnd: Date }) {
    const t = await createTenantWithUser(su, { name, email: `${name.toLowerCase().replace(/\s/g, "")}@test.local` });
    const sub = await su.subscription.create({
      data: { tenantId: t.tenant.id, planCode: "PROFESSIONAL", billingCycle: "MONTHLY", currentPeriodStart: new Date(o.periodEnd.getTime() - 30 * DAY), currentPeriodEnd: o.periodEnd, provider: "mock", cancelAtPeriodEnd: !!o.cancelAtPeriodEnd },
    });
    await su.savedPaymentMethod.create({ data: { tenantId: t.tenant.id, provider: "mock", token: o.token } });
    return { ...t, sub };
  }

  beforeAll(async () => {
    await resetDb(su);
    app = await createApp();
    jobs = app.get(JobsService);
    pay = app.get(PaymentProvider) as MockPaymentProvider;
    mail = app.get(MockEmailProvider);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("aynı gün ikinci çalıştırma atlanır; force ile tekrar çalışsa bile çift işlem olmaz", async () => {
    const t = await tenantWithSub("Yenilenen", { token: "tok_ok", periodEnd: new Date(now.getTime() - 1000) });
    const at = new Date(now.getTime() + 100 * DAY);
    await su.subscription.update({ where: { id: t.sub.id }, data: { currentPeriodEnd: new Date(at.getTime() - 1000) } });
    const first = await run({ at });
    expect(first).toMatchObject({ skipped: false });
    expect((first as any).result.renewed).toBe(1);
    const second = await run({ at });
    expect(second).toMatchObject({ skipped: true, reason: "Bugün zaten çalıştı" });
    const forced = await run({ at, force: true });
    expect((forced as any).result.renewed).toBe(0);
    expect(await su.subscriptionPayment.count({ where: { subscriptionId: t.sub.id } })).toBe(1);
    const s = await su.subscription.findUniqueOrThrow({ where: { id: t.sub.id } });
    expect(s.currentPeriodEnd.getTime()).toBe(addPeriod(new Date(at.getTime() - 1000), "MONTHLY").getTime());
    expect(pay.charges.filter((c) => c.tenantId === t.tenant.id)).toHaveLength(1);
    expect(mail.outbox.filter((m) => m.to === "yenilenen@test.local" && m.subject === "Aboneliğiniz yenilendi")).toHaveLength(1);
    const runs = await su.jobRun.findMany({ where: { runKey: "2030-06-18" } });
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("SUCCESS");
  });

  it("deneme bitişine 3 gün kala tek hatırlatma (aynı eşikte ikinci kez gönderilmez); bitince salt okunur (PAST_DUE)", async () => {
    const t = await createTenantWithUser(su, { name: "Deneme Salon", email: "deneme@test.local", status: "TRIAL" });
    await su.tenant.update({ where: { id: t.tenant.id }, data: { trialEndsAt: new Date(now.getTime() + 2 * DAY) } });
    await run({ at: now });
    await run({ at: new Date(now.getTime() + 3_600_000), force: true });
    expect(mail.outbox.filter((m) => m.to === "deneme@test.local" && m.subject.startsWith("Deneme sürenizin bitmesine"))).toHaveLength(1);
    const r = await run({ at: new Date(now.getTime() + 3 * DAY) });
    expect((r as any).result.trialsEnded).toBeGreaterThanOrEqual(1);
    const after = await su.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } });
    expect(after.status).toBe("PAST_DUE");
    expect(after.pastDueSince?.getTime()).toBe(now.getTime() + 2 * DAY);
    expect(mail.outbox.filter((m) => m.to === "deneme@test.local" && m.subject === "Deneme süreniz sona erdi")).toHaveLength(1);
  });

  it("deneme hatırlatmaları 7, 3 ve 1 gün kala birer kez gönderilir", async () => {
    const t = await createTenantWithUser(su, { name: "Yedi Gün", email: "yedigun@test.local", status: "TRIAL" });
    const base = new Date(now.getTime() + 1000 * DAY);
    await su.tenant.update({ where: { id: t.tenant.id }, data: { trialEndsAt: new Date(base.getTime() + 7 * DAY) } });
    const sent = () => mail.outbox.filter((m) => m.to === "yedigun@test.local" && m.subject.startsWith("Deneme sürenizin bitmesine"));
    await run({ at: base });
    await run({ at: new Date(base.getTime() + 1 * DAY) }); // 6 gün: 7 eşiği zaten gönderildi
    expect(sent()).toHaveLength(1);
    await run({ at: new Date(base.getTime() + 4 * DAY) }); // 3 gün
    await run({ at: new Date(base.getTime() + 4 * DAY + 3_600_000), force: true });
    expect(sent()).toHaveLength(2);
    await run({ at: new Date(base.getTime() + 6 * DAY) }); // 1 gün
    expect(sent()).toHaveLength(3);
    expect(sent().map((m) => m.subject)).toEqual([expect.stringContaining("7"), expect.stringContaining("3"), expect.stringContaining("1")]);
  });

  it("ödeme süresi (7 gün) dolunca abonelik iptal olur", async () => {
    const t = await createTenantWithUser(su, { name: "Gecikmeli", email: "gecikmeli@test.local" });
    await su.tenant.update({ where: { id: t.tenant.id }, data: { status: "PAST_DUE", pastDueSince: new Date(now.getTime() - 3 * DAY) } });
    await run({ at: new Date(now.getTime() + 1 * DAY + 3_600_000) });
    expect((await su.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).status).toBe("PAST_DUE");
    await run({ at: new Date(now.getTime() + 5 * DAY) });
    expect((await su.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).status).toBe("CANCELLED");
  });

  it("reddedilen yenileme ödemesi: PAST_DUE + tek e-posta; tekrar çalıştırmada ikinci tahsilat denenmez", async () => {
    const at = new Date(now.getTime() + 200 * DAY);
    const t = await tenantWithSub("Kartı Dolmuş", { token: "tok_expired", periodEnd: new Date(at.getTime() - 1000) });
    const r1 = await run({ at });
    expect((r1 as any).result.renewalFailed).toBe(1);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).status).toBe("PAST_DUE");
    await run({ at, force: true });
    const payments = await su.subscriptionPayment.findMany({ where: { subscriptionId: t.sub.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("FAILED");
    expect(mail.outbox.filter((m) => m.to === "kartıdolmuş@test.local" && m.subject === "Abonelik ödemesi alınamadı")).toHaveLength(1);
  });

  it("ödeme sağlayıcısı hatasında durum değişmez, görev PARTIAL kaydedilir; sonraki çalıştırmada başarılı olur", async () => {
    const at = new Date(now.getTime() + 300 * DAY);
    const t = await tenantWithSub("Ag Hatasi", { token: "tok_error", periodEnd: new Date(at.getTime() - 1000) });
    const r1 = await run({ at });
    expect((r1 as any).result.errors.join()).toMatch(/Ödeme sağlayıcısı hatası/);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).status).toBe("ACTIVE");
    expect((await su.jobRun.findFirstOrThrow({ where: { runKey: "2031-01-04" } })).status).toBe("PARTIAL");
    await su.savedPaymentMethod.updateMany({ where: { tenantId: t.tenant.id }, data: { token: "tok_ok" } });
    const r2 = await run({ at, force: true });
    expect((r2 as any).result.renewed).toBeGreaterThanOrEqual(1);
    expect(await su.subscriptionPayment.count({ where: { subscriptionId: t.sub.id, status: "PAID" } })).toBe(1);
  });

  it("iptal istenen abonelik dönem sonunda sona erer", async () => {
    const at = new Date(now.getTime() + 400 * DAY);
    const t = await tenantWithSub("Iptal Eden", { token: "tok_ok", cancelAtPeriodEnd: true, periodEnd: new Date(at.getTime() - 1000) });
    const r = await run({ at });
    expect((r as any).result.cancelledAtPeriodEnd).toBe(1);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).status).toBe("CANCELLED");
    expect(pay.charges.filter((c) => c.tenantId === t.tenant.id)).toHaveLength(0);
  });

  it("paket personel sınırı aşımı işaretlenir (bir kez bildirilir) ve düzelince kaldırılır", async () => {
    const t = await createTenantWithUser(su, { name: "Kalabalik", email: "kalabalik@test.local" });
    await su.tenant.update({ where: { id: t.tenant.id }, data: { planCode: "STARTER" } });
    for (const n of ["A", "B", "C", "D"]) await su.staffMember.create({ data: { tenantId: t.tenant.id, displayName: n } });
    const at = new Date(now.getTime() + 500 * DAY);
    await run({ at });
    await run({ at: new Date(at.getTime() + DAY) });
    expect((await su.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).limitExceededAt).toBeTruthy();
    expect(mail.outbox.filter((m) => m.to === "kalabalik@test.local" && m.subject === "Paket personel sınırı aşıldı")).toHaveLength(1);
    await su.staffMember.updateMany({ where: { tenantId: t.tenant.id, displayName: "D" }, data: { isActive: false } });
    const r = await run({ at: new Date(at.getTime() + 2 * DAY) });
    expect((r as any).result.limitResolved).toBe(1);
    expect((await su.tenant.findUniqueOrThrow({ where: { id: t.tenant.id } })).limitExceededAt).toBeNull();
  });

  it("canlı ortam kontrolü güvensiz yapılandırmayı yakalar", () => {
    const env = { ...loadEnv(), JWT_SECRET: "e2e-only-secret-0123456789abcdef0123456789abcdef", WEB_ORIGIN: "http://localhost:3000", MFA_ENFORCE_PLATFORM: "0" as const };
    const issues = productionIssues(env, { DATABASE_URL: "x" });
    const errors = issues.filter((i) => i.level === "error").map((i) => i.message).join("\n");
    expect(errors).toMatch(/JWT_SECRET zayıf/);
    expect(errors).toMatch(/WEB_ORIGIN https olmalı/);
    expect(errors).toMatch(/MFA_ENFORCE_PLATFORM/);
    expect(errors).toMatch(/geliştirme parolası/);
    const good = productionIssues(
      { ...env, JWT_SECRET: "9f3c1a7b2e8d4f60a1b2c3d4e5f60718293a4b5c6d7e8f90", WEB_ORIGIN: "https://app.proguzellik.com", MFA_ENFORCE_PLATFORM: "1", APP_DATABASE_URL: "postgresql://app_tenant:Xk29s@db.internal:5432/pg", PLATFORM_DATABASE_URL: "postgresql://app_platform:Yq81z@db.internal:5432/pg" },
      {},
    );
    expect(good.filter((i) => i.level === "error")).toEqual([]);
  });
});
