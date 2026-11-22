import { INestApplication } from "@nestjs/common";
import { AiQuotaService } from "../src/ai-quota/ai-quota.service";
import { AiTopupService, TOPUP_TERMS_VERSION } from "../src/ai-quota/ai-topup.service";
import { IyzicoClient } from "../src/billing/iyzico/iyzico.client";
import { IyzicoPaymentProvider, PaymentProvider } from "../src/billing/payment-provider";
import { FakeIyzico } from "./iyzico-fake";
import { api, approvePrice, createApp, createTenantWithUser, enableMfa, login, owner, resetDb } from "./helpers";

const billing = { fullName: "Ayşe Yılmaz", identityNumber: "11111111111", gsmNumber: "05551112233", city: "İstanbul", address: "Deneme Mah. 1. Sok. No:1" };
const body = (amount: number) => ({ amount, billing, acceptedTerms: true, acceptedInstantPerformance: true, termsVersion: TOPUP_TERMS_VERSION });

describe("Yapay zekâ ek paketi (sahte iyzico; gerçek ödeme yok)", () => {
  const su = owner();
  const fake = new FakeIyzico();
  let app: INestApplication;
  let topup: AiTopupService;
  let quota: AiQuotaService;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let P: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let mfaToken = "";
  const tokenOf = (html: string) => /iyzico (pf-[\w-]+)/.exec(html)![1];
  const ledgerSum = async (tenantId: string) => (await su.aiCreditLedger.aggregate({ where: { tenantId }, _sum: { amountKurus: true } }))._sum.amountKurus ?? 0;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Ek Paket Salon", email: "ep@test.local", status: "ACTIVE" });
    P = await createTenantWithUser(su, { name: "Pro Salon", email: "epp@test.local", status: "ACTIVE" });
    await su.tenant.update({ where: { id: A.tenant.id }, data: { planCode: "SMART" } });
    await su.tenant.update({ where: { id: P.tenant.id }, data: { planCode: "PROFESSIONAL" } });
    await approvePrice(su, "SMART", { monthly: 3000, yearly: 30000, vatRate: 20 });
    app = await createApp((b) => b.overrideProvider(IyzicoClient).useValue(fake).overrideProvider(PaymentProvider).useValue(new IyzicoPaymentProvider(() => true)));
    topup = app.get(AiTopupService);
    quota = app.get(AiQuotaService);
    await quota.updateSettings({ usdTry: 42, fxBuffer: 1.1, markup: 3, creditRatio: 0.5, trialCreditKurus: 2500, tenantDailyMaxUsd: 2, conversationMaxTokens: 150_000 }, A.user.id);
    a = api(app, await login(app, "ep@test.local"), A.tenant.id);
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("ekran: hazır tutarlar KDV dökümüyle, etki birimsiz (aylık hakkın yaklaşık katı); iç değer dönmez", async () => {
    const o = (await a.get("/ai-quota/topup").expect(200)).body;
    expect(o.available).toBe(true);
    const p1000 = o.presets.find((p: { amount: number }) => p.amount === 1000);
    // 1.000 TL KDV hariç → 500 TL değer = Akıllı aylık hakkın 1 katı
    expect(p1000).toMatchObject({ netAmount: "1000.00", vat: "200.00", grossAmount: "1200.00", vatRate: "20.00", monthsEquivalent: 1 });
    // 250 TL → 125 TL değer = aylık hakkın çeyreği (aşağı yuvarlanır, fazla vaat edilmez)
    expect(o.presets.find((p: { amount: number }) => p.amount === 250).monthsEquivalent).toBe(0.25);
    expect(o.presets.find((p: { amount: number }) => p.amount === 500).monthsEquivalent).toBe(0.5);
    expect(JSON.stringify(o)).not.toMatch(/credit|kurus/i);
    await a.get("/ai-quota/topup/quote?amount=275").expect(400);
    await a.get("/ai-quota/topup/quote?amount=100").expect(400);
    // Akıllı olmayan pakette satış yok
    const p = api(app, await login(app, "epp@test.local"), P.tenant.id);
    expect((await p.get("/ai-quota/topup").expect(200)).body).toMatchObject({ available: false });
    await p.post("/ai-quota/topup/checkout").send(body(500)).expect(403);
  });

  it("onaylar zorunlu; eski sözleşme sürümü reddedilir", async () => {
    await a.post("/ai-quota/topup/checkout").send({ ...body(500), acceptedTerms: false }).expect(400);
    await a.post("/ai-quota/topup/checkout").send({ ...body(500), termsVersion: "eski" }).expect(409);
  });

  it("başarılı ödeme: tutar doğrulanır, KDV hariç yarısı ek bakiyeye bir kez yüklenir; çift dönüş ikinci kez yüklemez", async () => {
    const before = await quota.wallet(A.tenant.id);
    const r = (await a.post("/ai-quota/topup/checkout").send(body(1000)).expect(201)).body;
    expect(r).toMatchObject({ amount: "1200.00", netAmount: "1000.00" });
    const token = tokenOf(r.checkoutFormContent);
    const form = fake.forms.get(token)!;
    expect(form.input).toMatchObject({ price: "1200.00", item: { name: "Yapay zekâ ek kullanım paketi" } });
    // Form doldurulmadan dönüş: bekler
    expect(await topup.completeCallback(token)).toMatchObject({ ok: false, pending: true });
    fake.payForm(token);
    const [r1, r2] = await Promise.all([topup.completeCallback(token), topup.completeCallback(token)]);
    expect(r1.ok && r2.ok).toBe(true);
    const w = await quota.wallet(A.tenant.id);
    expect(w.purchasedRemainingKurus - before.purchasedRemainingKurus).toBe(50_000);
    expect(await su.aiCreditLedger.count({ where: { tenantId: A.tenant.id, type: "PURCHASE_CREDIT" } })).toBe(1);
    expect(await ledgerSum(A.tenant.id)).toBe(w.monthlyRemainingKurus + w.purchasedRemainingKurus);
    const purchase = await su.aiCreditPurchase.findFirstOrThrow({ where: { token } });
    expect(purchase).toMatchObject({ status: "COMPLETED", iyzicoPaymentId: `pay-${token}` });
    // Bar: aylık hak 500 TL + ek 500 TL → hâlâ %100
    expect((await a.get("/ai-quota").expect(200)).body.percent).toBe(100);
  });

  it("tutar uyuşmazlığı ve başka sepet: yüklenmez, ödeme iptal edilir; incelemedeki ödeme bekler", async () => {
    const r1 = (await a.post("/ai-quota/topup/checkout").send(body(500)).expect(201)).body;
    const t1 = tokenOf(r1.checkoutFormContent);
    fake.payForm(t1, { paidPrice: 650 });
    expect(await topup.completeCallback(t1)).toMatchObject({ ok: false });
    expect(fake.cancelledPayments).toContain(`pay-${t1}`);

    const r2 = (await a.post("/ai-quota/topup/checkout").send(body(500)).expect(201)).body;
    const t2 = tokenOf(r2.checkoutFormContent);
    fake.payForm(t2, { basketId: "baska-sepet" });
    expect(await topup.completeCallback(t2)).toMatchObject({ ok: false });

    const r3 = (await a.post("/ai-quota/topup/checkout").send(body(500)).expect(201)).body;
    const t3 = tokenOf(r3.checkoutFormContent);
    fake.payForm(t3, { fraudStatus: 0 });
    expect(await topup.completeCallback(t3)).toMatchObject({ ok: false, pending: true });
    // İnceleme onaylandı: günlük uzlaştırma tamamlar
    fake.payForm(t3);
    await su.aiCreditPurchase.updateMany({ where: { token: t3 }, data: { createdAt: new Date(Date.now() - 3_600_000) } });
    const rec = await topup.reconcilePending();
    expect(rec).toMatchObject({ aiTopupsCompleted: 1, errors: [] });
    expect(await su.aiCreditLedger.count({ where: { tenantId: A.tenant.id, type: "PURCHASE_CREDIT" } })).toBe(2);
    const statuses = await su.aiCreditPurchase.findMany({ where: { token: { in: [t1, t2] } }, select: { status: true } });
    expect(statuses.every((s) => s.status === "FAILED")).toBe(true);
  });

  it("iade (SaaS sahibi): iyzico'da para iadesi + iade oranında değer geri alınır; fazla iade reddedilir; salon iade yapamaz", async () => {
    await su.user.update({ where: { id: A.user.id }, data: { isPlatformAdmin: true } });
    mfaToken = (await enableMfa(app, "ep@test.local")).token;
    const pa = api(app, mfaToken);
    const a2 = api(app, mfaToken, A.tenant.id);
    const list = (await pa.get("/platform/ai/purchases").expect(200)).body as { id: string; status: string; grossAmount: string; suggestedRefund: string }[];
    const p = list.find((x) => x.status === "COMPLETED" && x.grossAmount === "1200.00")!;
    expect(Number(p.suggestedRefund)).toBeGreaterThan(0);
    const before = await quota.wallet(A.tenant.id);
    const r = (await pa.post(`/platform/ai/purchases/${p.id}/refund`).send({ amount: 600 }).expect(200)).body;
    expect(r).toMatchObject({ status: "COMPLETED", refundedAmount: "600.00", creditTakenTl: "250.00" });
    expect(fake.refunds.at(-1)).toMatchObject({ price: "600.00" });
    expect((await quota.wallet(A.tenant.id)).purchasedRemainingKurus).toBe(before.purchasedRemainingKurus - 25_000);
    await pa.post(`/platform/ai/purchases/${p.id}/refund`).send({ amount: 700 }).expect(400);
    expect((await pa.post(`/platform/ai/purchases/${p.id}/refund`).send({ amount: 600 }).expect(200)).body.status).toBe("REFUNDED");
    const w = await quota.wallet(A.tenant.id);
    expect(await ledgerSum(A.tenant.id)).toBe(w.monthlyRemainingKurus + w.purchasedRemainingKurus);
    // Ücret alınıp reddedilen (tutar uyuşmazlığı) ve iptali tutmayan alım: listede "iade gerekli", iade cüzdana dokunmaz
    fake.failCancel = true;
    const r4 = (await a2.post("/ai-quota/topup/checkout").send(body(500)).expect(201)).body;
    const t4 = tokenOf(r4.checkoutFormContent);
    fake.payForm(t4, { paidPrice: 650, price: 650, itemTransactions: [{ itemId: "x", paymentTransactionId: `ptx-${t4}`, paidPrice: 650 }] });
    expect(await topup.completeCallback(t4)).toMatchObject({ ok: false });
    fake.failCancel = false;
    const failed = ((await pa.get("/platform/ai/purchases").expect(200)).body as { id: string; needsRefund: boolean; suggestedRefund: string }[]).find((x) => x.needsRefund)!;
    expect(failed.suggestedRefund).toBe("650.00");
    const walletBefore = await quota.wallet(A.tenant.id);
    expect((await pa.post(`/platform/ai/purchases/${failed.id}/refund`).send({ amount: 650 }).expect(200)).body).toMatchObject({ status: "FAILED", refundedAmount: "650.00", creditTakenTl: "0.00" });
    expect((await quota.wallet(A.tenant.id)).purchasedRemainingKurus).toBe(walletBefore.purchasedRemainingKurus);
    await pa.post(`/platform/ai/purchases/${failed.id}/refund`).send({ amount: 1 }).expect(400);
    // Aynı gün iptal edilen alımda iade kalmaz
    const cancelledRow = ((await pa.get("/platform/ai/purchases").expect(200)).body as { status: string; needsRefund: boolean; error: string | null }[]).filter((x) => x.status === "FAILED" && x.error?.includes("iptal edildi"));
    expect(cancelledRow.length).toBeGreaterThan(0);
    expect(cancelledRow.every((x) => !x.needsRefund)).toBe(true);
    const salon = api(app, await login(app, "epp@test.local"), P.tenant.id);
    await salon.post(`/platform/ai/purchases/${p.id}/refund`).send({ amount: 1 }).expect(403);
  });

  it("Finans gelir raporu: ek paket ayrı sütunda, KDV dahil ve iadeler düşülmüş; test (sandbox) ödemeleri sayılmaz", async () => {
    const pa = api(app, mfaToken);
    const year = new Date().getFullYear();
    const total = async () => (await pa.get(`/platform/finance/report?year=${year}&granularity=year`).expect(200)).body.totals.aiTopupCollected;
    expect(await total()).toBe("0.00");
    // Canlı ödeme benzetimi: tamamlanmış ve 600 TL iade edilmiş 1.200 TL'lik alım → 600; tamamen iade edilen → 0
    await su.aiCreditPurchase.updateMany({ where: { tenantId: A.tenant.id, status: { in: ["COMPLETED", "REFUNDED"] } }, data: { environment: "live" } });
    const rows = await su.aiCreditPurchase.findMany({ where: { tenantId: A.tenant.id, status: { in: ["COMPLETED", "REFUNDED"] } } });
    const expected = rows.reduce((a, r) => a + Number(r.grossAmount) - Number(r.refundedAmount), 0);
    expect(Number(await total())).toBeCloseTo(expected, 2);
    expect(expected).toBeGreaterThan(0);
  });
});
