import { INestApplication } from "@nestjs/common";
import { FetchLike, FxRateService, parseTcmbUsd, TCMB_TODAY_URL } from "../src/ai-quota/fx-rate.service";
import { api, createApp, createTenantWithUser, enableMfa, owner, resetDb } from "./helpers";

const xml = (date: string, sell: string, extra = "") => `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="isokur.xsl"?>
<Tarih_Date Tarih="${date}" Date="x"  Bulten_No="2026/219" >
	<Currency CrossOrder="0" Kod="USD" CurrencyCode="USD">
			<Unit>1</Unit>
			<Isim>ABD DOLARI</Isim>
			<ForexBuying>50.4028</ForexBuying>
			<ForexSelling>${sell}</ForexSelling>
			<BanknoteSelling>50.5694</BanknoteSelling>
	</Currency>
	<Currency CrossOrder="1" Kod="AUD" CurrencyCode="AUD"><Unit>1</Unit><ForexSelling>33.7377</ForexSelling></Currency>${extra}
</Tarih_Date>`;

describe("TCMB kur ayrıştırma", () => {
  it("USD döviz satış kurunu ve bülten tarihini okur (efektif değil)", () => {
    const r = parseTcmbUsd(xml("20.11.2026", "50.4936"));
    expect(r.forexSelling.toFixed(4)).toBe("50.4936");
    expect(r.date.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(r.bulletinNo).toBe("2026/219");
  });

  it("beklenmedik biçimde hata verir", () => {
    expect(() => parseTcmbUsd("<html>bakım</html>")).toThrow(/bülten tarihi/);
    expect(() => parseTcmbUsd(xml("20.11.2026", "abc"))).toThrow(/döviz satış/);
    expect(() => parseTcmbUsd(xml("31.02.2026", "50.1"))).toThrow(/tarihi geçersiz/);
    expect(() => parseTcmbUsd(xml("20.11.2026", "0"))).toThrow(/aralık/);
    expect(() => parseTcmbUsd(xml("20.11.2026", "50.1").replace("<Unit>1</Unit>", "<Unit>100</Unit>"))).toThrow(/birimi/);
  });
});

describe("TCMB kuru otomatik güncelleme", () => {
  let app: INestApplication;
  const su = owner();
  let fx: FxRateService;
  const calls: string[] = [];
  let next: () => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  const respond = (body: string, status = 200) => () => Promise.resolve({ ok: status < 300, status, text: () => Promise.resolve(body) });
  const settings = { usdTry: 40, fxBuffer: 1.1, markup: 3, creditRatio: 0.5, trialCreditKurus: 2500, tenantDailyMaxUsd: 2, conversationMaxTokens: 150_000 };

  beforeAll(async () => {
    app = await createApp();
    await resetDb(su);
    fx = app.get(FxRateService);
    const f: FetchLike = (url) => {
      calls.push(url);
      return next();
    };
    fx.fetcher = f;
  });
  afterAll(async () => {
    await app.close();
    await su.$disconnect();
  });

  it("ayar yokken kur kaydedilir ama ayar satırı oluşturulmaz (maliyet tavanları açılmaz)", async () => {
    next = respond(xml("20.11.2026", "50.4936"));
    const r = await fx.refresh(new Date("2026-11-20T13:00:00Z"));
    expect(r).toMatchObject({ ok: true, applied: false, rate: "50.4936" });
    expect(calls.at(-1)).toBe(TCMB_TODAY_URL);
    expect(await su.aiBillingSettings.count()).toBe(0);
    expect((await su.fxRate.findMany()).map((x) => x.forexSelling.toFixed(4))).toEqual(["50.4936"]);
  });

  it("ayar kaydında otomatik açıkken TCMB kuru kullanılır; sonraki bülten otomatik uygulanır ve denetime yazılır", async () => {
    await createTenantWithUser(su, { name: "Kur Sahibi", email: "fx@test.local", platformAdmin: true });
    const pa = api(app, (await enableMfa(app, "fx@test.local")).token);
    await pa.put("/platform/ai/settings").send(settings).expect(200);
    let s = await su.aiBillingSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(s).toMatchObject({ fxAuto: true });
    expect(s.usdTry.toFixed(4)).toBe("50.4936");
    expect(s.fxRateDate?.toISOString().slice(0, 10)).toBe("2026-11-20");

    next = respond(xml("21.11.2026", "50.6100"));
    expect(await fx.refresh(new Date("2026-11-21T13:00:00Z"))).toMatchObject({ ok: true, applied: true, rate: "50.6100" });
    s = await su.aiBillingSettings.findUniqueOrThrow({ where: { id: 1 } });
    expect(s.usdTry.toFixed(4)).toBe("50.6100");
    const audit = await su.auditLog.findFirstOrThrow({ where: { action: "ai.fx_updated" } });
    expect(audit.metadata).toMatchObject({ source: "TCMB", from: "50.4936", to: "50.6100", date: "2026-11-21" });

    // Aynı bülten tekrar okunursa yeniden uygulanmaz
    expect(await fx.refresh(new Date("2026-11-21T14:00:00Z"))).toMatchObject({ ok: true, applied: false });

    // Ekran durumu
    const o = (await pa.get("/platform/ai").expect(200)).body;
    expect(o.fx).toMatchObject({ auto: true, stale: false, tcmb: { rate: "50.6100", date: "2026-11-21" } });
    expect(o.settings).toMatchObject({ fxAuto: true, fxRateDate: "2026-11-21", usdTry: "50.6100" });
  });

  it("hata, zaman aşımı, eski bülten ve şüpheli sıçramada son geçerli kur kalır", async () => {
    next = respond("bakım", 503);
    expect(await fx.refresh(new Date("2026-11-21T15:00:00Z"))).toMatchObject({ ok: false, error: "TCMB HTTP 503" });
    next = () => Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    expect(await fx.refresh(new Date("2026-11-21T16:00:00Z"))).toMatchObject({ ok: false, error: "TCMB zaman aşımı" });
    next = respond(xml("19.11.2026", "49.0000"));
    expect(await fx.refresh(new Date("2026-11-21T17:00:00Z"))).toMatchObject({ ok: true, applied: false, rate: "50.6100" });
    next = respond(xml("24.11.2026", "70.0000"));
    const r = await fx.refresh(new Date("2026-11-24T13:00:00Z"));
    expect(r.ok).toBe(false);
    expect((await su.aiBillingSettings.findUniqueOrThrow({ where: { id: 1 } })).usdTry.toFixed(4)).toBe("50.6100");
    expect(await su.outboundEmail.count({ where: { template: "ai_fx_stale" } })).toBe(1);
  });

  it("3 günden uzun okunamazsa günde bir uyarı; elle kurda uyarı yok ve otomatik güncelleme yapılmaz", async () => {
    await su.outboundEmail.deleteMany({ where: { template: "ai_fx_stale" } });
    next = respond("", 500);
    await fx.refresh(new Date("2026-11-26T09:00:00Z"));
    await fx.refresh(new Date("2026-11-26T10:00:00Z"));
    expect(await su.outboundEmail.count({ where: { template: "ai_fx_stale" } })).toBe(1);

    await su.aiBillingSettings.update({ where: { id: 1 }, data: { fxAuto: false, usdTry: 52 } });
    await su.outboundEmail.deleteMany({ where: { template: "ai_fx_stale" } });
    await fx.refresh(new Date("2026-11-27T09:00:00Z"));
    expect(await su.outboundEmail.count({ where: { template: "ai_fx_stale" } })).toBe(0);
    next = respond(xml("27.11.2026", "50.9000"));
    expect(await fx.refresh(new Date("2026-11-27T13:00:00Z"))).toMatchObject({ ok: true, applied: false });
    expect((await su.aiBillingSettings.findUniqueOrThrow({ where: { id: 1 } })).usdTry.toFixed(4)).toBe("52.0000");
  });
});
