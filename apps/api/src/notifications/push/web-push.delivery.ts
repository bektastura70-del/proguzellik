import { Injectable } from "@nestjs/common";
import { Notification } from "@prisma/client";
import { loadEnv, webPushMode } from "../../config/env";
import { PrismaService } from "../../prisma/prisma.service";
import { effectivePwa } from "../../pwa/pwa-settings";
import type { PushPayload } from "./push.planner";
import { LiveWebPushSender, MockWebPushSender, PushResult } from "./web-push.sender";

/** Bu sayıda ardışık hatadan sonra abonelik devre dışı bırakılır. */
const MAX_FAILURES = 5;
const DEFAULT_TTL = 24 * 3600;

export class TransientPushError extends Error {}

/**
 * Kuyruktaki WEBPUSH bildiriminin gönderimi. Gönderim anında yeniden denetlenir:
 * bayrak + ortam kipi, alıcının hâlâ yetkili olması, tercihleri, randevunun durumu ve saati.
 * Alıcının tüm etkin cihazlarına gönderilir; en az biri başarılıysa SENT (yeniden denemede çift bildirim olmaz).
 * 404/410 dönen (tarayıcıda kaldırılmış) abonelikler devre dışı bırakılır.
 */
@Injectable()
export class WebPushDelivery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mock: MockWebPushSender,
    private readonly live: LiveWebPushSender,
  ) {}

  private async skip(id: string, error: string) {
    await this.prisma.platform.notification.update({ where: { id }, data: { status: "SKIPPED", error } });
    return "skipped" as const;
  }

  async deliver(n: Notification, lastAttempt: boolean): Promise<"sent" | "skipped"> {
    const db = this.prisma.platform;
    const mode = webPushMode(loadEnv());
    const pwa = await effectivePwa(db, n.tenantId);
    if (mode === "off" || !pwa.webPushEnabled) return this.skip(n.id, "Web Push kapalı");
    const p = n.payload as unknown as PushPayload;
    const [kind, ownerId] = n.recipient.split(":");
    const now = Date.now();
    if (p.expiresAt && Date.parse(p.expiresAt) <= now) return this.skip(n.id, "Süresi geçti");

    let role: string | null = null;
    if (kind === "identity") {
      if (!pwa.customerBookingEnabled) return this.skip(n.id, "Müşteri portalı kapalı");
      const idt = await db.customerIdentity.findFirst({ where: { id: ownerId, tenantId: n.tenantId }, select: { notifyAppointments: true, notifyReminders: true } });
      if (!idt) return this.skip(n.id, "Alıcı yok");
      if ((p.pref === "reminders" && !idt.notifyReminders) || (p.pref === "appointments" && !idt.notifyAppointments)) return this.skip(n.id, "Müşteri bu bildirimi kapattı");
    } else if (kind === "user") {
      if (!pwa.businessPwaEnabled) return this.skip(n.id, "İşletme uygulaması kapalı");
      const m = await db.membership.findFirst({ where: { tenantId: n.tenantId, userId: ownerId, isActive: true }, select: { role: true } });
      if (!m) return this.skip(n.id, "Kullanıcı artık işletmede değil");
      role = m.role;
      if (p.pref !== "test" && p.pref !== "appointments" && p.pref !== "reminders") {
        const pref = await db.userNotificationPreference.findUnique({ where: { tenantId_userId: { tenantId: n.tenantId, userId: ownerId } } });
        if (pref && !pref[p.pref]) return this.skip(n.id, "Kullanıcı bu bildirimi kapattı");
      }
    } else {
      return this.skip(n.id, "Geçersiz alıcı");
    }

    if (n.appointmentId && p.requireActive) {
      const appt = await db.appointment.findUnique({ where: { id: n.appointmentId }, select: { status: true, startsAt: true, staff: { select: { userId: true } } } });
      if (!appt || !["BOOKED", "CONFIRMED"].includes(appt.status)) return this.skip(n.id, "Randevu artık planlı değil");
      if (appt.startsAt.toISOString() !== p.startsAt) return this.skip(n.id, "Randevu saati değişti");
      // Personel yalnızca kendisine atanmış randevunun bildirimini alır (aktarıldıysa gönderilmez).
      if (role === "STAFF" && appt.staff.userId !== ownerId) return this.skip(n.id, "Randevu başka personele aktarıldı");
    }

    const subs = await db.pushSubscription.findMany({
      where: { tenantId: n.tenantId, revokedAt: null, ...(kind === "user" ? { audience: "STAFF", userId: ownerId } : { audience: "CUSTOMER", identityId: ownerId }) },
      select: { id: true, endpoint: true, p256dh: true, auth: true, failures: true },
    });
    if (!subs.length) return this.skip(n.id, "Etkin cihaz aboneliği yok");

    const sender = mode === "live" ? this.live : this.mock;
    const ttl = p.expiresAt ? Math.max(60, Math.floor((Date.parse(p.expiresAt) - now) / 1000)) : DEFAULT_TTL;
    const message = { title: p.title, body: p.body, url: p.url, tag: p.tag };
    const results: PushResult[] = [];
    for (const s of subs) {
      const r = await sender.send(s, message, ttl);
      results.push(r);
      if (r.ok) {
        await db.pushSubscription.update({ where: { id: s.id }, data: { failures: 0, lastSuccessAt: new Date() } });
      } else {
        const failures = s.failures + 1;
        await db.pushSubscription.update({
          where: { id: s.id },
          data: { failures, ...(r.gone || failures >= MAX_FAILURES ? { revokedAt: new Date() } : {}) },
        });
      }
    }
    const sent = results.filter((r) => r.ok).length;
    if (sent > 0) {
      await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, error: sent < subs.length ? `${subs.length - sent} cihaza ulaşılamadı` : null } });
      return "sent";
    }
    const transient = results.some((r) => !r.ok && !r.gone);
    if (!transient) return this.skip(n.id, "Tüm cihaz abonelikleri geçersiz");
    const err = (results.find((r) => !r.ok) as { error: string }).error;
    await db.notification.update({ where: { id: n.id }, data: { attempts: { increment: 1 }, error: err, ...(lastAttempt ? { status: "FAILED" } : {}) } });
    throw new TransientPushError(err);
  }
}
