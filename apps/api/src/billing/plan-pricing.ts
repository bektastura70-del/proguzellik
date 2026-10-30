import { HttpException, HttpStatus } from "@nestjs/common";
import { toZoned, zonedTime } from "../common/time";
import { BillingCycle, PlanPrice, Prisma, PrismaClient } from "@prisma/client";
import type { Tx } from "../prisma/prisma.service";

/**
 * Paket fiyat kuralları (tek yer):
 *  - Fiyatlar KDV hariç tutulur; her sürümün kendi KDV oranı vardır.
 *  - Yalnız SaaS sahibince onaylanmış (APPROVED) sürümler kullanılır; taslak/iptal sürüm hiçbir yerde fiyat sayılmaz.
 *  - Aynı anda yürürlükte birden çok onaylı sürüm varsa en son onaylanan (version büyük olan) geçerlidir.
 *  - Abonelik başladığında o anki sürüme kilitlenir. Yeni sürüm mevcut aboneliği geriye dönük değiştirmez;
 *    yalnız APPLY_ON_RENEWAL sürümü, renewalsFrom anında ya da sonrasında başlayan ilk yenileme döneminden itibaren uygulanır.
 */
export type PriceVersion = Pick<PlanPrice, "id" | "version" | "status" | "monthlyPrice" | "yearlyPrice" | "vatRate" | "effectiveFrom" | "renewalPolicy" | "renewalsFrom">;

const approved = (v: PriceVersion) => v.status === "APPROVED" && v.version != null;
const byVersionDesc = (a: PriceVersion, b: PriceVersion) => (b.version ?? 0) - (a.version ?? 0);

/** Yeni satışta (at anında başlayan abonelikte) geçerli sürüm. */
export function priceForNewSale<T extends PriceVersion>(versions: T[], at: Date): T | null {
  return versions.filter((v) => approved(v) && v.effectiveFrom.getTime() <= at.getTime()).sort(byVersionDesc)[0] ?? null;
}

/**
 * Yenilemede (periodStart anında başlayan yeni dönemde) geçerli sürüm.
 * locked: aboneliğin kilitli olduğu sürüm (yoksa eski abonelik: o anda yeni satış fiyatı uygulanır).
 */
export function priceForRenewal<T extends PriceVersion>(versions: T[], locked: T | null, periodStart: Date): T | null {
  const switchTo = versions
    .filter((v) => approved(v) && v.renewalPolicy === "APPLY_ON_RENEWAL" && v.renewalsFrom != null && v.renewalsFrom.getTime() <= periodStart.getTime() && (v.version ?? 0) > (locked?.version ?? 0))
    .sort(byVersionDesc)[0];
  if (switchTo) return switchTo;
  if (locked) return locked;
  return priceForNewSale(versions, periodStart);
}

/** Bir sonraki onaylı ama henüz yürürlüğe girmemiş sürüm (sitede/panelde bilgi için). */
export function upcomingPrice<T extends PriceVersion>(versions: T[], now: Date): T | null {
  const current = priceForNewSale(versions, now);
  return versions
    .filter((v) => approved(v) && v.effectiveFrom.getTime() > now.getTime() && (v.version ?? 0) > (current?.version ?? 0))
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())[0] ?? null;
}

export const cycleAmount = (v: Pick<PlanPrice, "monthlyPrice" | "yearlyPrice">, cycle: BillingCycle) => (cycle === "MONTHLY" ? v.monthlyPrice : v.yearlyPrice);

/** KDV hariç tutar + oran → KDV ve brüt (kuruşa yuvarlanır). */
export function withVat(net: Prisma.Decimal, rate: Prisma.Decimal) {
  const vat = net.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { net: net.toDecimalPlaces(2), vat, gross: net.plus(vat).toDecimalPlaces(2) };
}

/** Herkese açık / işletme paneli için paket görünümü: eski fiyat sütunları asla dışarı verilmez. */
export function publicPlanView(
  p: { code: string; name: string; description: string | null; maxStaff: number; maxCustomers: number | null; maxMonthlyAppointments: number | null; features: string[]; sortOrder: number },
  price: PriceVersion | null,
) {
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    maxStaff: p.maxStaff,
    maxCustomers: p.maxCustomers,
    maxMonthlyAppointments: p.maxMonthlyAppointments,
    features: p.features,
    sortOrder: p.sortOrder,
    /** Onaylı fiyat yoksa null: tutar gösterilmez, satın alma yapılamaz */
    monthlyPrice: price ? price.monthlyPrice.toFixed(2) : null,
    yearlyPrice: price ? price.yearlyPrice.toFixed(2) : null,
    vatRate: price ? price.vatRate.toFixed(2) : null,
    pricesIncludeVat: false as const,
  };
}

type Db = PrismaClient | Tx;
export const approvedVersionsOf = (db: Db, planCodes: string[]) =>
  db.planPrice.findMany({ where: { planCode: { in: planCodes }, status: "APPROVED" }, orderBy: { version: "desc" } });

/**
 * Paket kullanım sınırları (null = sınırsız). İşletme bağlamındaki transaction içinde çağrılır (RLS kendi verisini sayar).
 * Sınır aşılırsa 402 döner; mevcut kayıtlar etkilenmez, yalnız yeni kayıt engellenir.
 */
export async function assertUsageLimit(tx: Tx, tenantId: string, kind: "customer" | "appointment", at?: Date) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, plan: { select: { name: true, maxCustomers: true, maxMonthlyAppointments: true } } } });
  const { plan } = tenant;
  if (kind === "customer") {
    if (plan.maxCustomers == null) return;
    const n = await tx.customer.count({ where: { anonymizedAt: null } });
    if (n >= plan.maxCustomers) throw new UsageLimitError(`${plan.name} paketinde en fazla ${plan.maxCustomers} müşteri kaydı olabilir. Paketinizi yükseltin.`);
    return;
  }
  if (plan.maxMonthlyAppointments == null) return;
  const { from, to } = monthRange(at ?? new Date(), tenant.timezone);
  const n = await tx.appointment.count({ where: { startsAt: { gte: from, lt: to }, status: { not: "CANCELLED" } } });
  if (n >= plan.maxMonthlyAppointments) throw new UsageLimitError(`${plan.name} paketinde ayda en fazla ${plan.maxMonthlyAppointments} randevu olabilir. Paketinizi yükseltin.`);
}

export class UsageLimitError extends HttpException {
  constructor(message: string) {
    super({ message, code: "PLAN_USAGE_LIMIT" }, HttpStatus.PAYMENT_REQUIRED);
  }
}

/** Verilen anın işletme saat dilimindeki takvim ayı [başlangıç, bitiş). */
export function monthRange(at: Date, timeZone: string) {
  const { date } = toZoned(at, timeZone);
  const [y, m] = date.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: zonedTime(first, 0, timeZone), to: zonedTime(next, 0, timeZone) };
}
