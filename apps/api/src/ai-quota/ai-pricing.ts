import { Prisma } from "@prisma/client";
import { loadEnv } from "../config/env";

/** Bir yapay zekâ yanıtının (araç döngüsündeki tüm çağrılar) toplam token kullanımı. */
export interface AiUsage {
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (provider: string, model: string): AiUsage => ({ provider, model, calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

/** USD / milyon token */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Resmî fiyatlar (platform.claude.com/docs/en/about-claude/pricing, 21.11.2026'da okundu).
 * Claude Haiku 5.5: istem 100.000 token ve altı. Bizim akışta istem bu sınırın altında tutulur (geçmiş 20 mesaj, kırpma).
 * Fiyat değişirse burası ve AI_PRICE_USD_PER_MTOK güncellenir; tablo dışı model için ortam değişkeni zorunludur.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function priceFor(model: string): ModelPrice | null {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  const raw = loadEnv().AI_PRICE_USD_PER_MTOK;
  if (!raw) return null;
  const [input, output, cacheRead, cacheWrite] = raw.split(",").map(Number);
  return { input, output, cacheRead, cacheWrite };
}

/** Gerçek maliyet (mikro USD, yukarı yuvarlanır). Fiyatı bilinmeyen modelde null. */
export function costMicroUsd(u: AiUsage): number | null {
  if (u.calls === 0) return 0;
  const p = priceFor(u.model);
  if (!p) return null;
  // token × $/MTok = mikro USD
  const micro = u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite;
  return Math.ceil(micro);
}

export interface DebitSettings {
  usdTry: Prisma.Decimal;
  fxBuffer: Prisma.Decimal;
  markup: Prisma.Decimal;
}

/**
 * Salonun hakkından düşülecek iç değer (kuruş, yukarı yuvarlanır):
 * maliyet_USD × kur × kur_tamponu × çarpan × 100. Maliyet 0 ise 0.
 */
export function debitKurus(micro: number, s: DebitSettings): number {
  if (micro <= 0) return 0;
  const v = new Prisma.Decimal(micro).div(1_000_000).mul(s.usdTry).mul(s.fxBuffer).mul(s.markup).mul(100);
  return v.ceil().toNumber();
}

/** Ek paket: KDV hariç tutarın cüzdana yüklenen değeri (kuruş, aşağı yuvarlanır). */
export function creditForNet(net: Prisma.Decimal, ratio: Prisma.Decimal): number {
  return net.mul(100).mul(ratio).floor().toNumber();
}
