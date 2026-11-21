import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { appUrl, loadEnv } from "../config/env";
import { EmailService } from "../email/email.service";
import { PrismaService } from "../prisma/prisma.service";

/** TCMB günlük gösterge kurları (resmî, herkese açık). */
export const TCMB_TODAY_URL = "https://www.tcmb.gov.tr/kurlar/today.xml";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY = 1_000_000;
/** Son başarılı okumadan bu kadar süre geçtiyse SaaS sahibine uyarı (hafta sonu + resmî tatil payı). */
export const FX_STALE_MS = 3 * 86_400_000;
/** Bir önceki kayıtlı kurdan bu oranda fazla sapan değer şüpheli sayılır, otomatik uygulanmaz. */
const MAX_JUMP = 0.2;

export type TcmbUsd = { date: Date; forexSelling: Prisma.Decimal; bulletinNo: string | null };
export type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** TCMB today.xml içinden USD döviz satış kurunu ve bülten tarihini okur. Biçim beklenmedikse hata fırlatır. */
export function parseTcmbUsd(xml: string): TcmbUsd {
  const head = /<Tarih_Date\b[^>]*\bTarih="(\d{2})\.(\d{2})\.(\d{4})"[^>]*>/.exec(xml);
  if (!head) throw new Error("TCMB yanıtında bülten tarihi yok");
  const bulletin = /\bBulten_No="([^"]{1,40})"/.exec(head[0]);
  const block = /<Currency\b[^>]*\bCurrencyCode="USD"[^>]*>([\s\S]*?)<\/Currency>/.exec(xml);
  if (!block) throw new Error("TCMB yanıtında USD yok");
  const unit = /<Unit>\s*(\d+)\s*<\/Unit>/.exec(block[1]);
  if (unit && unit[1] !== "1") throw new Error(`TCMB USD birimi beklenmedik: ${unit[1]}`);
  const sell = /<ForexSelling>\s*(\d{1,6}(?:\.\d{1,6})?)\s*<\/ForexSelling>/.exec(block[1]);
  if (!sell) throw new Error("TCMB yanıtında USD döviz satış kuru yok");
  const [d, m, y] = [Number(head[1]), Number(head[2]), Number(head[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error("TCMB bülten tarihi geçersiz");
  const rate = new Prisma.Decimal(sell[1]);
  if (rate.lte(0) || rate.gte(10_000)) throw new Error(`TCMB USD kuru aralık dışında: ${sell[1]}`);
  return { date, forexSelling: rate.toDecimalPlaces(4), bulletinNo: bulletin?.[1] ?? null };
}

/**
 * Yapay zekâ düşüm hesabındaki USD/TL kurunu TCMB döviz satış kurundan günceller.
 * - Saatlik görev: bülten okunur, FxRate'e yazılır; ayar satırı varsa ve otomatik açıksa usdTry güncellenir.
 * - Hata, hafta sonu, tatil: son geçerli kur kullanılmaya devam eder.
 * - 3 günden uzun süre okunamazsa SaaS sahiplerine günde bir e-posta.
 * - Önceki kurdan %20'den fazla sapan değer otomatik uygulanmaz (SaaS sahibi elle girer).
 */
@Injectable()
export class FxRateService {
  private readonly logger = new Logger("FxRate");
  /** Testler için değiştirilebilir. */
  fetcher: FetchLike = (url, init) => fetch(url, init);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  latest() {
    return this.prisma.platform.fxRate.findFirst({ where: { currency: "USD" }, orderBy: { date: "desc" } });
  }

  async fetchTcmb(): Promise<TcmbUsd> {
    const url = loadEnv().TCMB_FX_URL ?? TCMB_TODAY_URL;
    const res = await this.fetcher(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: "application/xml", "User-Agent": "ProGuzellik-Kur/1.0" } });
    if (!res.ok) throw new Error(`TCMB HTTP ${res.status}`);
    const body = await res.text();
    if (body.length > MAX_BODY) throw new Error("TCMB yanıtı beklenenden büyük");
    return parseTcmbUsd(body);
  }

  /** Görev ve "Şimdi güncelle" düğmesi. Hata fırlatmaz; sonucu döndürür. */
  async refresh(now = new Date(), actorId: string | null = null) {
    const db = this.prisma.platform;
    let fetched: TcmbUsd;
    try {
      fetched = await this.fetchTcmb();
    } catch (e) {
      const error = (e as Error).name === "TimeoutError" ? "TCMB zaman aşımı" : (e as Error).message.slice(0, 200);
      this.logger.warn(`Kur okunamadı: ${error}`);
      await this.checkStale(now);
      return { ok: false as const, error };
    }
    const prev = await this.latest();
    if (prev && prev.date > fetched.date) {
      // TCMB eski bülten döndürdüyse (önbellek) yenisinin üzerine yazılmaz.
      return { ok: true as const, applied: false, rate: prev.forexSelling.toFixed(4), date: prev.date };
    }
    const jump = prev ? fetched.forexSelling.sub(prev.forexSelling).abs().div(prev.forexSelling) : new Prisma.Decimal(0);
    if (jump.gt(MAX_JUMP)) {
      const error = `TCMB kuru (${fetched.forexSelling.toFixed(4)}) önceki kurdan (${prev!.forexSelling.toFixed(4)}) %${jump.mul(100).toFixed(0)} farklı; otomatik uygulanmadı`;
      this.logger.error(error);
      await this.notify("jump", now, error);
      return { ok: false as const, error };
    }
    await db.fxRate.upsert({
      where: { currency_date: { currency: "USD", date: fetched.date } },
      create: { currency: "USD", date: fetched.date, forexSelling: fetched.forexSelling, bulletinNo: fetched.bulletinNo, fetchedAt: now },
      update: { forexSelling: fetched.forexSelling, bulletinNo: fetched.bulletinNo, fetchedAt: now },
    });
    const applied = await this.apply(fetched, actorId);
    return { ok: true as const, applied, rate: fetched.forexSelling.toFixed(4), date: fetched.date };
  }

  /** Ayar satırı varsa ve otomatik açıksa kuru uygular. Ayar yoksa satır oluşturulmaz (maliyet tavanları açılmasın). */
  private async apply(r: TcmbUsd, actorId: string | null) {
    const db = this.prisma.platform;
    const s = await db.aiBillingSettings.findUnique({ where: { id: 1 } });
    if (!s || !s.fxAuto) return false;
    if (s.usdTry.eq(r.forexSelling) && s.fxRateDate?.getTime() === r.date.getTime()) return false;
    await db.aiBillingSettings.update({ where: { id: 1 }, data: { usdTry: r.forexSelling, fxRateDate: r.date } });
    await db.auditLog.create({
      data: { actorId, action: "ai.fx_updated", metadata: { source: "TCMB", currency: "USD", from: s.usdTry.toFixed(4), to: r.forexSelling.toFixed(4), date: r.date.toISOString().slice(0, 10), bulletinNo: r.bulletinNo } },
    });
    return true;
  }

  /** Son başarılı okuma 3 günden eskiyse (otomatik kur açıkken) uyarır. */
  async checkStale(now = new Date()) {
    const s = await this.prisma.platform.aiBillingSettings.findUnique({ where: { id: 1 } });
    if (s && !s.fxAuto) return false;
    const last = await this.prisma.platform.fxRate.findFirst({ where: { currency: "USD" }, orderBy: { fetchedAt: "desc" } });
    const stale = !last || now.getTime() - last.fetchedAt.getTime() > FX_STALE_MS;
    if (stale && s) await this.notify("stale", now, last ? `Son başarılı okuma: ${last.fetchedAt.toISOString()}` : "Henüz hiç okunamadı");
    return stale;
  }

  private async notify(kind: "stale" | "jump", now: Date, detail: string) {
    const db = this.prisma.platform;
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(now);
    const admins = await db.user.findMany({ where: { isPlatformAdmin: true }, select: { email: true } });
    const link = `${appUrl(loadEnv())}/platform?sekme=yapay-zeka`;
    for (const u of admins) {
      await this.email
        .send(u.email, { name: "ai_fx_stale", vars: { detail, link } }, { dedupeKey: `ai-fx-${kind}:${day}:${u.email}` })
        .catch((e) => this.logger.error(`Kur uyarı e-postası: ${(e as Error).message}`));
    }
  }

  /** SaaS sahibi ekranı için durum. */
  async status(now = new Date()) {
    const [s, last] = await Promise.all([this.prisma.platform.aiBillingSettings.findUnique({ where: { id: 1 } }), this.latest()]);
    return {
      auto: s?.fxAuto ?? true,
      tcmb: last && { rate: last.forexSelling.toFixed(4), date: last.date.toISOString().slice(0, 10), fetchedAt: last.fetchedAt, bulletinNo: last.bulletinNo },
      stale: !last || now.getTime() - last.fetchedAt.getTime() > FX_STALE_MS,
    };
  }
}
