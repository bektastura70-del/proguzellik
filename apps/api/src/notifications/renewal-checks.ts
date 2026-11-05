import { Notification, PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { toZoned } from "../common/time";
import { appUrl, loadEnv, renewalRemindersOn } from "../config/env";

/** Yenilenme hatırlatması: gönderim anı denetimleri (kuyruk işçisi kullanır; NotificationQueue'ya bağımlı değildir). */
export const RENEWAL_TEMPLATE = "yenileme_hatirlatma";

/** Bildirim kaydında saklanan yenileme bağlamı (gönderim anında yeniden denetlenir). */
export interface RenewalRef {
  sourceAppointmentId: string;
  serviceId: string;
  customerId: string;
  /** Yenileme günü (işletme saat dilimine göre YYYY-MM-DD) */
  dueDay: string;
}

/** E-postadaki "hatırlatmaları kapat" bağlantısının imzası (yalnızca bu müşterinin bu işletmedeki hatırlatmalarını kapatır). */
export function sign(tenantId: string, customerId: string) {
  return createHmac("sha256", loadEnv().JWT_SECRET).update(`renewal-optout:${tenantId}:${customerId}`).digest("base64url");
}
export const renewalOptOutToken = (tenantId: string, customerId: string) => `${tenantId}.${customerId}.${sign(tenantId, customerId)}`;

/**
 * Kuyruk işçisi gönderimden hemen önce çağırır: hatırlatma artık gerekmiyorsa nedenini döner (SKIPPED olarak işaretlenir).
 */
export async function renewalSkipReason(db: PrismaClient, n: Notification, now = new Date()): Promise<string | null> {
  if (!renewalRemindersOn(loadEnv())) return "Yenilenme hatırlatması kapalı";
  const ref = (n.payload as { renewal?: RenewalRef } | null)?.renewal;
  if (!ref) return "Geçersiz hatırlatma kaydı";
  const tenant = await db.tenant.findUnique({ where: { id: n.tenantId }, select: { status: true, renewalRemindersEnabled: true, timezone: true } });
  if (!tenant || !tenant.renewalRemindersEnabled || !["TRIAL", "ACTIVE"].includes(tenant.status)) return "İşletmede yenilenme hatırlatması kapalı";
  if (toZoned(now, tenant.timezone).date >= ref.dueDay) return "Yenileme tarihi geldi/geçti";
  const c = await db.customer.findFirst({ where: { id: ref.customerId, tenantId: n.tenantId }, select: { marketingConsent: true, renewalRemindersOptOutAt: true, anonymizedAt: true } });
  if (!c || c.anonymizedAt) return "Müşteri yok";
  if (c.renewalRemindersOptOutAt) return "Müşteri hatırlatmaları kapattı";
  if (!c.marketingConsent) return "Ticari ileti izni yok";
  const s = await db.service.findFirst({ where: { id: ref.serviceId, tenantId: n.tenantId }, select: { isActive: true, rebookAfterDays: true, renewalRemindDaysBefore: true } });
  if (!s?.isActive || !s.rebookAfterDays || !s.renewalRemindDaysBefore) return "Hizmet artık hatırlatma gerektirmiyor";
  const src = await db.appointment.findFirst({ where: { id: ref.sourceAppointmentId, tenantId: n.tenantId }, select: { status: true, startsAt: true } });
  if (!src || src.status !== "COMPLETED") return "Kaynak işlem artık tamamlanmış değil";
  const later = await db.appointment.count({
    where: { tenantId: n.tenantId, customerId: ref.customerId, serviceId: ref.serviceId, OR: [{ status: "COMPLETED", startsAt: { gt: src.startsAt } }, { status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { gt: now } }] },
  });
  if (later) return "Müşteri zaten randevu almış ya da yeni işlem yapılmış";
  return null;
}

/** E-posta şablon değişkenleri gönderim anında üretilir (vazgeçme bağlantısı veritabanında tutulmaz). */
export async function renewalEmailVars(db: PrismaClient, n: Notification) {
  const ref = (n.payload as unknown as { renewal: RenewalRef }).renewal;
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: n.tenantId }, select: { name: true, slug: true, phone: true } });
  const c = await db.customer.findFirstOrThrow({ where: { id: ref.customerId, tenantId: n.tenantId }, select: { firstName: true } });
  const s = await db.service.findFirstOrThrow({ where: { id: ref.serviceId, tenantId: n.tenantId }, select: { name: true } });
  const base = appUrl(loadEnv());
  const dueDate = new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${ref.dueDay}T12:00:00Z`));
  return {
    salon: tenant.name, firstName: c.firstName, service: s.name, dueDate, phone: tenant.phone ?? undefined,
    link: `${base}/r/${tenant.slug}`,
    optOutLink: `${base}/r/${tenant.slug}/hatirlatma-kapat?t=${encodeURIComponent(renewalOptOutToken(n.tenantId, ref.customerId))}`,
  };
}
