import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { LedgerEntryType, LedgerPaymentMethod, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { dec, Dec, ZERO } from "./money";

export interface CompanyInput {
  legalName?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  taxOffice?: string | null;
  iban?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  vatRate?: number | null;
  pricesIncludeVat?: boolean | null;
  paymentTermDays?: number;
  invoiceNote?: string | null;
}

export interface EntryInput {
  tenantId: string;
  type: LedgerEntryType;
  amount: number;
  description: string;
  occurredAt?: string;
  dueDate?: string;
  periodStart?: string;
  periodEnd?: string;
  subscriptionId?: string;
  relatedEntryId?: string;
  method?: LedgerPaymentMethod;
  reference?: string;
  requestId: string;
}

type Entry = Prisma.PlatformLedgerEntryGetPayload<object>;

/** Cari bakiye: pozitif = işletmenin borcu (SaaS sahibinin alacağı), negatif = fazla tahsilat (işletmeye borç). */
export function balanceOf(entries: Pick<Entry, "type" | "amount">[]) {
  const sum = (t: LedgerEntryType) => entries.filter((e) => e.type === t).reduce((s, e) => s.plus(e.amount), ZERO);
  const accrued = sum("ACCRUAL"), cancelled = sum("ACCRUAL_CANCEL"), collected = sum("PAYMENT"), refunded = sum("REFUND");
  return { accrued, cancelled, collected, refunded, netAccrued: accrued.minus(cancelled), netCollected: collected.minus(refunded), balance: accrued.minus(cancelled).minus(collected).plus(refunded) };
}

const fmt = (d: Dec) => d.toFixed(2);

/** SaaS sahibi muhasebesi: şirket bilgisi, işletme fatura bilgisi, cari hesap ve raporlar. Yalnızca platform rolü. */
@Injectable()
export class PlatformFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.platform;
  }

  async company() {
    return (await this.db.platformCompany.findUnique({ where: { id: 1 } })) ?? { id: 1, legalName: null, address: null, taxNumber: null, taxOffice: null, iban: null, email: null, phone: null, website: null, vatRate: null, pricesIncludeVat: null, paymentTermDays: 7, invoiceNote: null, updatedAt: null, updatedById: null };
  }

  async updateCompany(actorId: string, input: CompanyInput, ip?: string) {
    const before = await this.company();
    const row = await this.db.platformCompany.upsert({ where: { id: 1 }, create: { id: 1, ...input, updatedById: actorId }, update: { ...input, updatedById: actorId } });
    // IBAN ve VKN denetim kaydında maskelenir.
    const mask = (v: unknown) => (typeof v === "string" && v.length > 4 ? `${"•".repeat(v.length - 4)}${v.slice(-4)}` : v);
    const changes = Object.fromEntries(Object.keys(input).map((k) => [k, ["iban", "taxNumber"].includes(k) ? { from: mask((before as Record<string, unknown>)[k]), to: mask((input as Record<string, unknown>)[k]) } : { from: (before as Record<string, unknown>)[k] ?? null, to: (input as Record<string, unknown>)[k] ?? null }]));
    await this.db.auditLog.create({ data: { actorId, ip, action: "platform.company_updated", entity: "PlatformCompany", metadata: JSON.parse(JSON.stringify(changes)) } });
    return row;
  }

  billingProfile(tenantId: string) {
    return this.db.tenantBillingProfile.findUnique({ where: { tenantId } });
  }

  async updateBillingProfile(tenantId: string, actorId: string, input: { legalName: string; taxNumber?: string | null; taxOffice?: string | null; address?: string | null; email?: string | null }, ip?: string) {
    if (!(await this.db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw new NotFoundException("İşletme bulunamadı");
    const row = await this.db.tenantBillingProfile.upsert({ where: { tenantId }, create: { tenantId, ...input }, update: input });
    await this.db.auditLog.create({ data: { tenantId, actorId, ip, action: "platform.billing_profile_updated", entity: "TenantBillingProfile", entityId: tenantId } });
    return row;
  }

  /** Cari kayıt ekler. Tüm kurallar işletme bazında kilit altında denetlenir; aynı requestId ikinci kez uygulanmaz. */
  async addEntry(actorId: string, i: EntryInput, ip?: string) {
    const prior = await this.db.platformLedgerEntry.findUnique({ where: { requestId: i.requestId } });
    if (prior) {
      if (prior.tenantId !== i.tenantId || prior.type !== i.type || !prior.amount.equals(dec(i.amount))) throw new ConflictException("Bu istek kimliği başka bir işlemde kullanıldı");
      return { entry: prior, replayed: true };
    }
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"platform-ledger:" + i.tenantId}))`;
        const tenant = await tx.tenant.findUnique({ where: { id: i.tenantId }, select: { id: true } });
        if (!tenant) throw new NotFoundException("İşletme bulunamadı");
        const amount = dec(i.amount);
        let related: Entry | null = null;
        if (i.relatedEntryId) {
          related = await tx.platformLedgerEntry.findUnique({ where: { id: i.relatedEntryId } });
          if (!related || related.tenantId !== i.tenantId) throw new NotFoundException("İlişkili kayıt bulunamadı");
        }
        if (i.subscriptionId) {
          const sub = await tx.subscription.findUnique({ where: { id: i.subscriptionId } });
          if (!sub || sub.tenantId !== i.tenantId) throw new NotFoundException("Abonelik bulunamadı");
          if (sub.isComplimentary) throw new ConflictException("Ücretsiz tanımlanan aboneliğe tahakkuk/tahsilat bağlanamaz");
        }
        const deps = related ? await tx.platformLedgerEntry.findMany({ where: { relatedEntryId: related.id } }) : [];
        const depSum = (t: LedgerEntryType) => deps.filter((d) => d.type === t).reduce((s, d) => s.plus(d.amount), ZERO);
        switch (i.type) {
          case "ACCRUAL":
            if (related || i.method) throw new BadRequestException("Tahakkuk başka bir kayda bağlanmaz");
            break;
          case "PAYMENT":
            if (!i.method) throw new BadRequestException("Tahsilat yöntemi girin");
            if (related) {
              if (related.type !== "ACCRUAL") throw new BadRequestException("Tahsilat yalnızca tahakkuka bağlanır");
              const open = related.amount.minus(depSum("PAYMENT")).minus(depSum("ACCRUAL_CANCEL"));
              if (amount.gt(open)) throw new ConflictException(`Tahakkukun açık tutarı ${fmt(open)} ₺; daha fazla tahsilat bağlanamaz`);
            }
            break;
          case "REFUND":
            if (!related || related.type !== "PAYMENT") throw new BadRequestException("İade bir tahsilata bağlanmalı");
            if (!i.method) throw new BadRequestException("İade yöntemi girin");
            if (amount.gt(related.amount.minus(depSum("REFUND")))) throw new ConflictException(`İade edilebilir tutar ${fmt(related.amount.minus(depSum("REFUND")))} ₺`);
            break;
          case "ACCRUAL_CANCEL": {
            if (!related || related.type !== "ACCRUAL") throw new BadRequestException("İptal bir tahakkuka bağlanmalı");
            const open = related.amount.minus(depSum("PAYMENT")).minus(depSum("ACCRUAL_CANCEL"));
            if (amount.gt(open)) throw new ConflictException(`Tahsil edilmemiş tutar ${fmt(open)} ₺; tahsil edilen kısım iptal edilemez, iade girin`);
            break;
          }
        }
        const entry = await tx.platformLedgerEntry.create({
          data: {
            tenantId: i.tenantId, type: i.type, amount, description: i.description,
            occurredAt: i.occurredAt ? new Date(i.occurredAt) : new Date(),
            dueDate: i.dueDate ? new Date(i.dueDate) : null,
            periodStart: i.periodStart ? new Date(i.periodStart) : null,
            periodEnd: i.periodEnd ? new Date(i.periodEnd) : null,
            subscriptionId: i.subscriptionId ?? (i.type === "ACCRUAL" ? null : related?.subscriptionId ?? null),
            relatedEntryId: related?.id ?? null,
            method: i.method ?? null, reference: i.reference ?? null, requestId: i.requestId, actorId,
          },
        });
        await tx.auditLog.create({ data: { tenantId: i.tenantId, actorId, ip, action: `platform.ledger_${i.type.toLowerCase()}`, entity: "PlatformLedgerEntry", entityId: entry.id, metadata: { amount: fmt(amount), relatedEntryId: related?.id ?? null } } });
        return { entry, replayed: false };
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await this.db.platformLedgerEntry.findUnique({ where: { requestId: i.requestId } });
        if (again) return { entry: again, replayed: true };
      }
      throw e;
    }
  }

  /** İşletmenin cari hesap ekstresi: kayıtlar, tahakkuk bazında ödenen/kalan ve bakiye. */
  async ledger(tenantId: string) {
    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } });
    if (!tenant) throw new NotFoundException("İşletme bulunamadı");
    const entries = await this.db.platformLedgerEntry.findMany({ where: { tenantId }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }], include: { invoice: { select: { id: true, draftNo: true, officialNumber: true, status: true } } } });
    const now = new Date();
    let running = ZERO;
    const rows = entries.map((e) => {
      running = e.type === "ACCRUAL" || e.type === "REFUND" ? running.plus(e.amount) : running.minus(e.amount);
      const deps = entries.filter((d) => d.relatedEntryId === e.id);
      const paid = deps.filter((d) => d.type === "PAYMENT").reduce((s, d) => s.plus(d.amount), ZERO);
      const cancelled = deps.filter((d) => d.type === "ACCRUAL_CANCEL").reduce((s, d) => s.plus(d.amount), ZERO);
      const refunded = deps.filter((d) => d.type === "REFUND").reduce((s, d) => s.plus(d.amount), ZERO);
      const open = e.type === "ACCRUAL" ? e.amount.minus(paid).minus(cancelled) : null;
      const state = e.type !== "ACCRUAL" ? null : open!.isZero() ? (paid.isZero() ? "CANCELLED" : "PAID") : paid.gt(0) ? "PARTIAL" : e.dueDate && e.dueDate < now ? "OVERDUE" : "OPEN";
      return { ...e, amount: fmt(e.amount), runningBalance: fmt(running), paid: fmt(paid), cancelled: fmt(cancelled), refunded: fmt(refunded), open: open ? fmt(open) : null, state };
    });
    const b = balanceOf(entries);
    return { tenant, entries: rows, totals: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, fmt(v)])) };
  }

  /** Tüm işletmelerin cari özeti: borç/alacak ve vadesi geçenler. */
  async accounts() {
    const [tenants, sums, overdue] = await Promise.all([
      this.db.tenant.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: "asc" } }),
      this.db.platformLedgerEntry.groupBy({ by: ["tenantId", "type"], _sum: { amount: true } }),
      this.db.$queryRaw<{ tenantId: string; overdue: Prisma.Decimal }[]>`
        SELECT a."tenantId", sum(a.amount - COALESCE((SELECT sum(d.amount) FROM "PlatformLedgerEntry" d WHERE d."relatedEntryId" = a.id AND d.type IN ('PAYMENT','ACCRUAL_CANCEL')), 0)) AS overdue
        FROM "PlatformLedgerEntry" a WHERE a.type = 'ACCRUAL' AND a."dueDate" < now() GROUP BY a."tenantId"`,
    ]);
    const rows = tenants
      .map((t) => {
        const mine = sums.filter((s) => s.tenantId === t.id).map((s) => ({ type: s.type, amount: s._sum.amount ?? ZERO }));
        if (!mine.length) return null;
        const b = balanceOf(mine);
        const od = overdue.find((o) => o.tenantId === t.id)?.overdue ?? ZERO;
        return {
          tenant: t,
          accrued: fmt(b.netAccrued), collected: fmt(b.collected), refunded: fmt(b.refunded), balance: fmt(b.balance),
          overdue: fmt(dec(od).gt(0) ? dec(od) : ZERO),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const all = balanceOf(sums.map((s) => ({ type: s.type, amount: s._sum.amount ?? ZERO })));
    const receivable = rows.reduce((s, r) => (dec(r.balance).gt(0) ? s.plus(r.balance) : s), ZERO);
    const payable = rows.reduce((s, r) => (dec(r.balance).lt(0) ? s.minus(r.balance) : s), ZERO);
    return { rows, totals: { ...Object.fromEntries(Object.entries(all).map(([k, v]) => [k, fmt(v)])), receivable: fmt(receivable), payable: fmt(payable) } };
  }

  /**
   * Gelir raporu (İstanbul saatine göre ay/yıl). Tahakkuk, tahsilat ve iade ayrı; bekleyen tutar dönem sonu bakiyesi.
   * Manuel ücretsiz tanımlamalar gelir sayılmaz, ayrı listelenir. Online sağlayıcı tahsilatları ayrı sütundur (iade edilenler ve sandbox test ödemeleri hariç).
   */
  async report(year: number, granularity: "month" | "year") {
    const unit = granularity === "month" ? "month" : "year";
    const from = new Date(`${year}-01-01T00:00:00+03:00`);
    const to = new Date(`${year + 1}-01-01T00:00:00+03:00`);
    const ledger = await this.db.$queryRaw<{ period: string; type: LedgerEntryType; total: Prisma.Decimal }[]>`
      SELECT to_char(date_trunc(${unit}, "occurredAt" AT TIME ZONE 'Europe/Istanbul'), 'YYYY-MM') AS period, type, sum(amount) AS total
      FROM "PlatformLedgerEntry" WHERE "occurredAt" >= ${from} AND "occurredAt" < ${to} GROUP BY 1, 2`;
    const online = await this.db.$queryRaw<{ period: string; total: Prisma.Decimal }[]>`
      SELECT to_char(date_trunc(${unit}, "createdAt" AT TIME ZONE 'Europe/Istanbul'), 'YYYY-MM') AS period, sum(amount) AS total
      FROM "SubscriptionPayment" WHERE status = 'PAID' AND provider NOT LIKE '%sandbox%' AND "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1`;
    const grants = await this.db.$queryRaw<{ period: string; n: bigint; agreed: Prisma.Decimal }[]>`
      SELECT to_char(date_trunc(${unit}, "createdAt" AT TIME ZONE 'Europe/Istanbul'), 'YYYY-MM') AS period, count(*) AS n, sum("agreedAmount") AS agreed
      FROM "SubscriptionGrant" WHERE "isComplimentary" AND action IN ('CREATED', 'RENEWED', 'EXTENDED') AND "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1`;
    const opening = await this.db.platformLedgerEntry.groupBy({ by: ["type"], where: { occurredAt: { lt: from } }, _sum: { amount: true } });
    let balance = balanceOf(opening.map((o) => ({ type: o.type, amount: o._sum.amount ?? ZERO }))).balance;
    const periods = granularity === "month" ? Array.from({ length: 12 }, (_, m) => `${year}-${String(m + 1).padStart(2, "0")}`) : [`${year}-01`];
    const rows = periods.map((p) => {
      const get = (t: LedgerEntryType) => dec(ledger.find((l) => l.period === p && l.type === t)?.total ?? 0);
      const accrued = get("ACCRUAL").minus(get("ACCRUAL_CANCEL"));
      const collected = get("PAYMENT");
      const refunded = get("REFUND");
      balance = balance.plus(accrued).minus(collected).plus(refunded);
      const g = grants.find((x) => x.period === p);
      return {
        period: granularity === "month" ? p : String(year),
        accrued: fmt(accrued),
        collected: fmt(collected),
        refunded: fmt(refunded),
        netCollected: fmt(collected.minus(refunded)),
        onlineCollected: fmt(dec(online.find((o) => o.period === p)?.total ?? 0)),
        pendingAtEnd: fmt(balance),
        complimentaryGrants: Number(g?.n ?? 0),
      };
    });
    const total = (k: "accrued" | "collected" | "refunded" | "netCollected" | "onlineCollected") => fmt(rows.reduce((s, r) => s.plus(r[k]), ZERO));
    return {
      year,
      granularity,
      rows,
      totals: { accrued: total("accrued"), collected: total("collected"), refunded: total("refunded"), netCollected: total("netCollected"), onlineCollected: total("onlineCollected"), pending: fmt(balance), complimentaryGrants: rows.reduce((s, r) => s + r.complimentaryGrants, 0) },
    };
  }
}

/** CSV (Excel uyumlu: UTF-8 BOM, noktalı virgül ayraç, formül enjeksiyonu engellenir). */
export function toCsv(head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}
