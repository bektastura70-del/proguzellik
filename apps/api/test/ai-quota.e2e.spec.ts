import { INestApplication } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AiUsage, costMicroUsd, creditForNet, debitKurus } from "../src/ai-quota/ai-pricing";
import { addMonths, AiQuotaService, periodFor, remainingPercent } from "../src/ai-quota/ai-quota.service";
import { loadEnv } from "../src/config/env";
import { ChatAgent, ChatInput, ChatOutput, consentValid, MockChatAgent } from "../src/messaging/chat/chat-agent";
import { QUOTA_NOTICE } from "../src/messaging/chat/conversation-engine";
import { PrismaService } from "../src/prisma/prisma.service";
import { signedPost, waText } from "./meta-helpers";
import { api, createApp, createTenantWithUser, enableMfa, login, owner, resetDb, setupSalon } from "./helpers";

const usage = (inputTokens: number, outputTokens: number, extra: Partial<AiUsage> = {}): AiUsage => ({ provider: "anthropic", model: "claude-haiku-5-5", calls: 1, inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, ...extra });
const setMode = (m: "off" | "shadow" | "enforce") => ((loadEnv() as { AI_QUOTA_MODE: string }).AI_QUOTA_MODE = m);

describe("Yapay zekâ fiyat hesabı (saf fonksiyonlar)", () => {
  const s = { usdTry: new Prisma.Decimal(42), fxBuffer: new Prisma.Decimal(1.1), markup: new Prisma.Decimal(3) };

  it("token maliyeti Haiku tarifesiyle mikro USD olarak yukarı yuvarlanır", () => {
    // 10.000 girdi × 0,10 + 1.000 çıktı × 0,50 + 20.000 önbellek okuma × 0,01 + 3.000 önbellek yazma × 0,125
    expect(costMicroUsd(usage(10_000, 1_000, { cacheReadTokens: 20_000, cacheWriteTokens: 3_000 }))).toBe(1000 + 500 + 200 + 375);
    expect(costMicroUsd({ ...usage(0, 0), calls: 0 })).toBe(0);
    expect(costMicroUsd(usage(1, 1, { model: "bilinmeyen-model" }))).toBeNull();
  });

  it("düşüm = maliyet × kur × tampon × çarpan (kuruş, yukarı); paket değeri = net × oran (aşağı)", () => {
    // 6.300 mikro USD = 0,0063 $ → 0,0063 × 42 × 1,1 × 3 × 100 = 87,318 → 88 kuruş
    expect(debitKurus(6300, s)).toBe(88);
    expect(debitKurus(0, s)).toBe(0);
    expect(debitKurus(1, s)).toBe(1);
    expect(creditForNet(new Prisma.Decimal("1000.00"), new Prisma.Decimal("0.5"))).toBe(50_000);
    expect(creditForNet(new Prisma.Decimal("333.33"), new Prisma.Decimal("0.5"))).toBe(16_666);
  });

  it("zarar etmeme: cüzdan değeri tamamen harcansa bile gerçek API harcaması değer / (çarpan × tampon) ile sınırlıdır", () => {
    const value = 50_000; // kuruş
    let spentMicro = 0;
    let left = value;
    while (left > 0) {
      const micro = 6300;
      left -= debitKurus(micro, s);
      spentMicro += micro;
    }
    const spentTl = (spentMicro / 1e6) * 42;
    expect(spentTl).toBeLessThanOrEqual(value / 100 / (3 * 1.1) + 0.5);
  });

  it("dönem hesabı ay sonunu taşırmaz; yüzde 5'in katına yuvarlanır ve az hak varken 0 gösterilmez", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    const p = periodFor(new Date("2026-01-15T00:00:00Z"), new Date("2026-03-20T00:00:00Z"));
    expect(p.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-04-15T00:00:00.000Z");
    const w = { monthlyGrantKurus: 50_000, monthlyRemainingKurus: 31_000, purchasedRemainingKurus: 0, purchasedPeakKurus: 0 };
    expect(remainingPercent(w)).toBe(60);
    expect(remainingPercent({ ...w, monthlyRemainingKurus: 100 })).toBe(5);
    expect(remainingPercent({ ...w, monthlyRemainingKurus: -50 })).toBe(0);
    expect(remainingPercent({ ...w, monthlyRemainingKurus: 0, purchasedRemainingKurus: 25_000, purchasedPeakKurus: 50_000 })).toBe(25);
  });

  it("onay sağlayıcıya bağlıdır: sağlayıcı değişince eski onay geçersiz", () => {
    const c = { aiDataConsentAt: new Date(), aiDataConsentProvider: "openai" };
    expect(consentValid(c, "openai")).toBe(true);
    expect(consentValid(c, "anthropic")).toBe(false);
    expect(consentValid(c, null)).toBe(true);
    expect(consentValid({ aiDataConsentAt: null, aiDataConsentProvider: null }, null)).toBe(false);
  });
});

/** Senaryolu ajan: sıradaki adım varsa onu, yoksa yerel test ajanını çalıştırır. Dış servise istek atmaz. */
class ScriptedAgent extends ChatAgent {
  readonly name = "mock" as const;
  steps: ((i: ChatInput) => Promise<ChatOutput>)[] = [];
  calls: ChatInput[] = [];
  private readonly fallback = new MockChatAgent();
  reply(input: ChatInput) {
    this.calls.push(input);
    const step = this.steps.shift();
    return step ? step(input) : this.fallback.reply(input);
  }
}

const SECRET = "dddddddddddddddddddddddddddddddd";
const PHONE_ID = "3265403522430";

describe("Yapay zekâ kullanım hakkı: cüzdan, defter, dönem, motor", () => {
  const su = owner();
  const agent = new ScriptedAgent();
  let app: INestApplication;
  let quota: AiQuotaService;
  let A: Awaited<ReturnType<typeof createTenantWithUser>>;
  let T: Awaited<ReturnType<typeof createTenantWithUser>>;
  let P: Awaited<ReturnType<typeof createTenantWithUser>>;
  let a: ReturnType<typeof api>;
  let n = 0;
  const ledgerSum = async (tenantId: string) => (await su.aiCreditLedger.aggregate({ where: { tenantId }, _sum: { amountKurus: true } }))._sum.amountKurus ?? 0;

  beforeAll(async () => {
    await resetDb(su);
    A = await createTenantWithUser(su, { name: "Akıllı Salon", email: "qa@test.local", status: "ACTIVE" });
    T = await createTenantWithUser(su, { name: "Deneme Salon", email: "qt@test.local", status: "TRIAL" });
    P = await createTenantWithUser(su, { name: "Profesyonel Salon", email: "qp@test.local", status: "ACTIVE" });
    await su.tenant.updateMany({ where: { id: { in: [A.tenant.id, T.tenant.id] } }, data: { planCode: "SMART" } });
    await su.tenant.update({ where: { id: P.tenant.id }, data: { planCode: "PROFESSIONAL" } });
    app = await createApp((m) => m.overrideProvider(ChatAgent).useValue(agent));
    quota = app.get(AiQuotaService);
    await quota.updateSettings({ usdTry: 42, fxBuffer: 1.1, markup: 3, creditRatio: 0.5, trialCreditKurus: 2500, tenantDailyMaxUsd: 2, conversationMaxTokens: 150_000 }, A.user.id);
    a = api(app, await login(app, "qa@test.local"), A.tenant.id);
  });
  afterAll(async () => {
    setMode("off");
    await app.close();
    await su.$disconnect();
  });

  it("Akıllı pakette aylık 500 TL değer, denemede deneme değeri, diğer pakette hak yok", async () => {
    expect((await quota.wallet(A.tenant.id)).monthlyGrantKurus).toBe(50_000);
    expect((await quota.wallet(T.tenant.id)).monthlyGrantKurus).toBe(2500);
    expect((await quota.wallet(P.tenant.id)).monthlyGrantKurus).toBe(0);
    // İkinci çağrı yeniden hak yazmaz
    await quota.wallet(A.tenant.id);
    expect(await su.aiCreditLedger.count({ where: { tenantId: A.tenant.id, type: "MONTHLY_GRANT" } })).toBe(1);
    // Deneme → ücretli: dönem içinde fark eklenir
    await su.tenant.update({ where: { id: T.tenant.id }, data: { status: "ACTIVE" } });
    const w = await quota.wallet(T.tenant.id);
    expect(w).toMatchObject({ monthlyGrantKurus: 50_000, monthlyRemainingKurus: 50_000 });
    expect(await ledgerSum(T.tenant.id)).toBe(50_000);
  });

  it("off modunda kullanım kaydedilir ama hak düşülmez", async () => {
    setMode("off");
    const ev = await quota.record({ tenantId: A.tenant.id, usage: usage(20_000, 500), outcome: "replied" });
    expect(ev).toMatchObject({ debitKurus: 0, costMicroUsd: 2250 });
    expect((await quota.wallet(A.tenant.id)).monthlyRemainingKurus).toBe(50_000);
  });

  it("tavanlar her modda uygulanır: salon günlük maliyet ve konuşma token sınırı (off modunda bile)", async () => {
    setMode("off");
    const conversationId = "00000000-0000-4000-8000-000000000001";
    expect(await quota.gate(P.tenant.id, conversationId)).toEqual({ ok: true });
    // 150.000 token sınırı: tek kayıt 160.000 token
    await quota.record({ tenantId: P.tenant.id, conversationId: null, usage: usage(10, 10), outcome: "replied" });
    await su.aiUsageEvent.create({ data: { tenantId: P.tenant.id, conversationId, provider: "anthropic", model: "claude-haiku-5-5", calls: 1, inputTokens: 160_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 16_000, debitKurus: 0, outcome: "replied" } });
    expect(await quota.gate(P.tenant.id, conversationId)).toMatchObject({ ok: false, reason: "conversation_cap" });
    // Günlük $2 sınırı (başka konuşma)
    await su.aiUsageEvent.create({ data: { tenantId: P.tenant.id, provider: "anthropic", model: "claude-haiku-5-5", calls: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 2_000_000, debitKurus: 0, outcome: "replied" } });
    expect(await quota.gate(P.tenant.id, "00000000-0000-4000-8000-000000000002")).toMatchObject({ ok: false, reason: "daily_cap" });
    // SaaS sahibine günde bir e-posta (ikinci aşımda tekrar gitmez)
    const admin = await su.user.create({ data: { email: "saas-ai@test.local", fullName: "SaaS Sahibi", passwordHash: "x", isPlatformAdmin: true } });
    await quota.gate(P.tenant.id, "00000000-0000-4000-8000-000000000003");
    await quota.gate(P.tenant.id, "00000000-0000-4000-8000-000000000004");
    expect(await su.outboundEmail.count({ where: { to: admin.email, template: "ai_daily_cap" } })).toBe(1);
    await su.aiUsageEvent.deleteMany({ where: { tenantId: P.tenant.id } });
  });

  it("eşzamanlı 40 kayıt: cüzdan ile defter toplamı birebir tutar (kilit)", async () => {
    setMode("shadow");
    await Promise.all(Array.from({ length: 40 }, () => quota.record({ tenantId: A.tenant.id, usage: usage(40_000, 1_000), outcome: "replied" })));
    // 40.000 × 0,1 + 1.000 × 0,5 = 4.500 mikro USD → 0,0045 × 42 × 1,1 × 3 × 100 = 62,37 → 63 kuruş
    const w = await quota.wallet(A.tenant.id);
    expect(w.monthlyRemainingKurus).toBe(50_000 - 40 * 63);
    expect(await ledgerSum(A.tenant.id)).toBe(w.monthlyRemainingKurus + w.purchasedRemainingKurus);
  });

  it("defter yalnız eklenir: güncelleme ve silme reddedilir; salon rolü tabloları okuyamaz", async () => {
    const row = await su.aiCreditLedger.findFirstOrThrow({ where: { tenantId: A.tenant.id } });
    await expect(su.aiCreditLedger.update({ where: { id: row.id }, data: { amountKurus: 1 } })).rejects.toThrow();
    await expect(su.aiCreditLedger.delete({ where: { id: row.id } })).rejects.toThrow();
    const prisma = app.get(PrismaService);
    await expect(prisma.withTenant({ tenantId: A.tenant.id, userId: A.user.id }, (tx) => tx.aiWallet.findMany())).rejects.toThrow();
  });

  it("ek paket: değer ek bakiyeye yazılır, aynı satın alma iki kez yazılmaz; aylık hak bitince ek bakiyeden düşülür", async () => {
    setMode("shadow");
    const purchase = await su.aiCreditPurchase.create({
      data: { tenantId: A.tenant.id, userId: A.user.id, environment: "sandbox", conversationId: `ai-test-${Date.now()}`, netAmount: "200.00", vatRate: "20.00", grossAmount: "240.00", creditKurus: 10_000, status: "COMPLETED", termsVersion: "test" },
    });
    const prisma = app.get(PrismaService);
    await prisma.platform.$transaction((tx) => quota.creditPurchase(tx, { tenantId: A.tenant.id, purchaseId: purchase.id, creditKurus: 10_000 }));
    await expect(prisma.platform.$transaction((tx) => quota.creditPurchase(tx, { tenantId: A.tenant.id, purchaseId: purchase.id, creditKurus: 10_000 }))).rejects.toThrow();
    let w = await quota.wallet(A.tenant.id);
    expect(w).toMatchObject({ purchasedRemainingKurus: 10_000, purchasedPeakKurus: 10_000 });
    expect(w.purchasedExpiresAt).not.toBeNull();
    // Aylık hakkı bitir: kalanın tamamı kadar tek düşüm
    await su.aiWallet.update({ where: { tenantId: A.tenant.id }, data: { monthlyRemainingKurus: 30 } });
    await su.aiCreditLedger.create({ data: { tenantId: A.tenant.id, bucket: "MONTHLY", type: "ADMIN_ADJUST", amountKurus: 30 - (await ledgerSum(A.tenant.id)) + 10_000, idempotencyKey: `adj-${Date.now()}` } });
    await quota.record({ tenantId: A.tenant.id, usage: usage(40_000, 1_000), outcome: "replied" });
    w = await quota.wallet(A.tenant.id);
    expect(w.monthlyRemainingKurus).toBe(0);
    expect(w.purchasedRemainingKurus).toBe(10_000 - 33);
    expect(await ledgerSum(A.tenant.id)).toBe(w.monthlyRemainingKurus + w.purchasedRemainingKurus);
  });

  it("dönem dolunca kalan aylık hak sona erer ve yeni dönem hakkı yazılır; ek bakiye korunur", async () => {
    const before = await quota.wallet(A.tenant.id);
    const later = new Date(before.periodEnd.getTime() + 3_600_000);
    const res = await quota.runDaily(later);
    expect(res.errors).toEqual([]);
    const w = await su.aiWallet.findUniqueOrThrow({ where: { tenantId: A.tenant.id } });
    expect(w.periodStart.getTime()).toBe(before.periodEnd.getTime());
    expect(w).toMatchObject({ monthlyGrantKurus: 50_000, monthlyRemainingKurus: 50_000, purchasedRemainingKurus: before.purchasedRemainingKurus });
    expect(await ledgerSum(A.tenant.id)).toBe(w.monthlyRemainingKurus + w.purchasedRemainingKurus);
  });

  it("salon paneli yalnız yaklaşık yüzde ve durum görür; para veya birim dönmez", async () => {
    const body = (await a.get("/ai-quota").expect(200)).body;
    expect(body).toMatchObject({ available: true, state: "ok" });
    expect(body.percent % 5).toBe(0);
    expect(JSON.stringify(body)).not.toMatch(/Kurus|kurus|TL|usd|cost/i);
    const p = api(app, await login(app, "qp@test.local"), P.tenant.id);
    expect((await p.get("/ai-quota").expect(200)).body).toEqual({ available: false });
  });

  it("enforce: hak bitince model çağrılmaz, müşteriye bir kez sabit bilgi gider, konuşma personele geçer, kanal ayarı değişmez", async () => {
    setMode("enforce");
    const s = await setupSalon(a);
    expect(s).toBeTruthy();
    const conn = (await a.put("/channels/whatsapp").send({ externalId: PHONE_ID, businessAccountId: "1000000004", accessToken: "EAAquotaTOKENdddddddddddddddddddddd", appSecret: SECRET }).expect(200)).body.id;
    await a.post("/channels/whatsapp/verify").expect(200);
    await a.patch("/channels/whatsapp/ai").send({ aiAutoReply: true, aiDataConsent: true }).expect(200);

    // Önce hak var: yanıt verilir ve kullanım kaydedilir
    agent.steps.push(async () => ({ text: "Merhaba, nasıl yardımcı olabilirim?", tools: [], usage: usage(30_000, 800) }));
    const callsBefore = agent.calls.length;
    await signedPost(app, conn, waText(PHONE_ID, "905550000099", `wamid.Q${++n}`, "Merhaba"), SECRET).expect(200);
    const conv = await waitFor(() => su.conversation.findFirst({ where: { tenantId: A.tenant.id, externalUserId: "905550000099" } }), (c) => !!c);
    await waitFor(() => su.aiUsageEvent.count({ where: { conversationId: conv!.id } }), (c) => c > 0);
    expect(agent.calls.length).toBe(callsBefore + 1);

    // Hakkı bitir
    const w = await quota.wallet(A.tenant.id);
    await su.aiWallet.update({ where: { tenantId: A.tenant.id }, data: { monthlyRemainingKurus: 0, purchasedRemainingKurus: 0 } });
    await su.aiCreditLedger.create({ data: { tenantId: A.tenant.id, bucket: "MONTHLY", type: "ADMIN_ADJUST", amountKurus: -(w.monthlyRemainingKurus + w.purchasedRemainingKurus), idempotencyKey: `adj2-${Date.now()}` } });

    await signedPost(app, conn, waText(PHONE_ID, "905550000099", `wamid.Q${++n}`, "Yarın yeriniz var mı?"), SECRET).expect(200);
    const human = await waitFor(() => su.conversation.findUniqueOrThrow({ where: { id: conv!.id } }), (c) => c.mode === "HUMAN");
    expect(human).toMatchObject({ mode: "HUMAN", handoffReason: "Yapay zekâ kullanım hakkı doldu" });
    expect(agent.calls.length).toBe(callsBefore + 1);
    const notices = await su.conversationMessage.findMany({ where: { conversationId: conv!.id, author: "SYSTEM", text: QUOTA_NOTICE } });
    expect(notices).toHaveLength(1);
    const c = await su.channelConnection.findUniqueOrThrow({ where: { id: conn } });
    expect(c.aiAutoReply).toBe(true);
    expect((await a.get("/ai-quota").expect(200)).body).toMatchObject({ state: "empty", percent: 0 });
  });

  it("SaaS sahibi paneli gerçek maliyeti görür; çarpan 1'in altına indirilemez", async () => {
    await su.user.update({ where: { id: A.user.id }, data: { isPlatformAdmin: true } });
    const pa = api(app, (await enableMfa(app, "qa@test.local")).token);
    const o = (await pa.get("/platform/ai").expect(200)).body;
    expect(o.tenants.find((t: { tenantId: string }) => t.tenantId === A.tenant.id)).toMatchObject({ name: "Akıllı Salon" });
    expect(Number(o.last30Days.costUsd)).toBeGreaterThan(0);
    await pa.put("/platform/ai/settings").send({ usdTry: 42, fxBuffer: 1.1, markup: 0.5, creditRatio: 0.5, trialCreditKurus: 2500, tenantDailyMaxUsd: 2, conversationMaxTokens: 150_000 }).expect(400);
    // Salon kullanıcısı göremez
    await su.user.update({ where: { id: A.user.id }, data: { isPlatformAdmin: false } });
    const sa = api(app, await login(app, "qp@test.local"), P.tenant.id);
    await sa.get("/platform/ai").expect(403);
  });
});

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 12_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}
