import { Prisma } from "@prisma/client";

const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export const dec = (v: Prisma.Decimal.Value) => new D(v);
export const ZERO = new D(0);
export const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, D.ROUND_HALF_UP);

/**
 * Satır tutarı: fiyatlar KDV dahilse brüt üzerinden net ayrıştırılır, değilse net üzerine KDV eklenir.
 * Yuvarlama satır bazında, 2 ondalık, yarım yukarı.
 */
export function lineAmounts(quantity: Prisma.Decimal.Value, unitPrice: Prisma.Decimal.Value, vatRate: Prisma.Decimal.Value, pricesIncludeVat: boolean) {
  const base = round2(dec(quantity).mul(unitPrice));
  const r = dec(vatRate).div(100);
  if (pricesIncludeVat) {
    const net = round2(base.div(r.plus(1)));
    return { net, vat: base.minus(net), gross: base };
  }
  const vat = round2(base.mul(r));
  return { net: base, vat, gross: base.plus(vat) };
}
