import { PrismaClient } from "@prisma/client";
import { canonicalPhone, trNational } from "../common/phone";

/**
 * Mükerrer müşteri raporu ve (yalnızca açık onayla) birleştirme.
 *
 * Gruplar:
 *  - "telefon": aynı numara farklı yazımla (0532… / +90532… / 532…) iki kayıtta — büyük olasılıkla aynı kişi.
 *  - "e-posta": aynı e-posta (büyük/küçük harf farkı yok sayılır).
 *  - "ad-soyad": aynı ad soyad, farklı telefon — aynı kişi olmayabilir; salon teyit etmeden birleştirilmez.
 */
export interface DupCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  createdAt: Date;
  appointments: number;
  packages: number;
  sales: number;
  transactions: number;
}
export interface DupGroup {
  tenantId: string;
  tenantSlug: string;
  reason: "telefon" | "e-posta" | "ad-soyad";
  /** Önerilen ana kayıt: en çok geçmişi olan, eşitse en eski */
  keepId: string;
  customers: DupCustomer[];
}

const norm = (v: string) => v.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");

/** Telefonu kısmen gizler (rapor terminalde görünür): 0532***2233 */
export const maskPhone = (p: string | null) => (p ? `${p.slice(0, 4)}***${p.slice(-4)}` : "—");

export async function findDuplicates(platform: PrismaClient, opts: { tenantSlug?: string } = {}): Promise<DupGroup[]> {
  const tenants = await platform.tenant.findMany({ where: opts.tenantSlug ? { slug: opts.tenantSlug } : {}, select: { id: true, slug: true } });
  const out: DupGroup[] = [];
  for (const t of tenants) {
    const rows = await platform.customer.findMany({
      where: { tenantId: t.id, anonymizedAt: null },
      select: {
        id: true, firstName: true, lastName: true, phone: true, email: true, source: true, createdAt: true,
        _count: { select: { appointments: true, packages: true, productSales: true, transactions: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const list: DupCustomer[] = rows.map((r) => ({
      id: r.id, name: `${r.firstName} ${r.lastName}`, phone: r.phone, email: r.email, source: r.source, createdAt: r.createdAt,
      appointments: r._count.appointments, packages: r._count.packages, sales: r._count.productSales, transactions: r._count.transactions,
    }));
    const seen = new Set<string>();
    const group = (reason: DupGroup["reason"], keyOf: (c: DupCustomer) => string | null) => {
      const by = new Map<string, DupCustomer[]>();
      for (const c of list) {
        const k = keyOf(c);
        if (!k) continue;
        by.set(k, [...(by.get(k) ?? []), c]);
      }
      for (const cs of by.values()) {
        if (cs.length < 2) continue;
        const sig = cs.map((c) => c.id).sort().join(",");
        if (seen.has(sig)) continue;
        seen.add(sig);
        // Kasa/satış kaydı olan kayıt ana kalmalı (o kayıtlar taşınamaz); sonra en çok geçmiş, sonra en eski.
        const ledger = (c: DupCustomer) => (c.sales + c.transactions > 0 ? 1 : 0);
        const score = (c: DupCustomer) => c.appointments + c.packages + c.sales + c.transactions;
        const keep = [...cs].sort((a, b) => ledger(b) - ledger(a) || score(b) - score(a) || a.createdAt.getTime() - b.createdAt.getTime())[0];
        out.push({ tenantId: t.id, tenantSlug: t.slug, reason, keepId: keep.id, customers: cs });
      }
    };
    group("telefon", (c) => (c.phone && trNational(c.phone) ? canonicalPhone(c.phone) : null));
    group("e-posta", (c) => (c.email ? c.email.trim().toLowerCase() : null));
    group("ad-soyad", (c) => norm(c.name));
  }
  return out;
}

export class MergeError extends Error {}

/**
 * İki müşteri kaydını birleştirir: geçmiş (randevu, paket, not, bildirim, konuşma)
 * ana kayda taşınır, boş alanlar diğer kayıttan doldurulur, diğer kayıt silinir. Tek transaction; hata olursa hiçbir şey değişmez.
 * İzinler (KVKK onayı, ticari ileti) ana kayıttan alınır; diğer kayıtta ticari ileti izni varsa yalnızca uyarı verilir.
 * Kiracı bağlamı (RLS) ayarlanarak app_tenant bağlantısıyla çalışır.
 */
export async function mergeCustomers(tenantDb: PrismaClient, input: { tenantId: string; keepId: string; mergeId: string; note: string }) {
  if (input.keepId === input.mergeId) throw new MergeError("Aynı kayıt kendisiyle birleştirilemez");
  return tenantDb.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true), set_config('app.user_id', '', true)`;
    const [keep, merge] = await Promise.all([
      tx.customer.findUnique({ where: { id: input.keepId } }),
      tx.customer.findUnique({ where: { id: input.mergeId } }),
    ]);
    if (!keep || !merge) throw new MergeError("Müşteri kaydı bulunamadı (işletme doğru mu?)");
    if (keep.anonymizedAt || merge.anonymizedAt) throw new MergeError("Anonimleştirilmiş kayıt birleştirilemez");
    const where = { customerId: merge.id };
    const data = { customerId: keep.id };
    // Kasa hareketleri ve ürün satışları değiştirilemez kayıtlardır (append-only): taşınmaz.
    // Silinecek kayıtta varsa birleştirme yapılmaz; o kaydı ana kayıt seçmek gerekir.
    const [ledger, sales] = await Promise.all([tx.financeTransaction.count({ where }), tx.productSale.count({ where })]);
    if (ledger || sales) {
      throw new MergeError("Silinecek kayıtta kasa hareketi ya da ürün satışı var; bu kaydı --ana olarak seçin (diğerini silin)");
    }
    const moved = {
      appointments: (await tx.appointment.updateMany({ where, data })).count,
      packages: (await tx.customerPackage.updateMany({ where, data })).count,
      notes: (await tx.customerNote.updateMany({ where, data })).count,
      notifications: (await tx.notification.updateMany({ where, data })).count,
      conversations: (await tx.conversation.updateMany({ where, data })).count,
    };
    const warnings: string[] = [];
    if (merge.marketingConsent && !keep.marketingConsent) warnings.push("Birleştirilen kayıtta ticari ileti izni vardı; ana kayıtta yok (izin taşınmadı)");
    if (merge.phone && keep.phone && canonicalPhone(merge.phone) !== canonicalPhone(keep.phone)) warnings.push(`Farklı telefon silinen kayıtla gitti: ${maskPhone(merge.phone)} (gerekirse ana kayda not edildi)`);
    const extraNote = [
      keep.notes,
      merge.notes,
      merge.phone && keep.phone && canonicalPhone(merge.phone) !== canonicalPhone(keep.phone) ? `Diğer telefon (birleştirilen kayıttan): ${merge.phone}` : null,
    ].filter(Boolean).join("\n") || null;
    // Önce diğer kaydı sil (telefon benzersizliği), sonra ana kaydı doldur.
    await tx.customer.delete({ where: { id: merge.id } });
    await tx.customer.update({
      where: { id: keep.id },
      data: {
        phone: keep.phone ? canonicalPhone(keep.phone) : merge.phone ? canonicalPhone(merge.phone) : null,
        email: keep.email ?? merge.email,
        birthDate: keep.birthDate ?? merge.birthDate,
        gender: keep.gender ?? merge.gender,
        notes: extraNote,
        tags: [...new Set([...keep.tags, ...merge.tags])],
        kvkkConsentAt: keep.kvkkConsentAt ?? merge.kvkkConsentAt,
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId, action: "customer.merged", entity: "Customer", entityId: keep.id,
        metadata: { mergedId: merge.id, moved, note: input.note.slice(0, 500), via: "cli" },
      },
    });
    return { moved, warnings };
  });
}
