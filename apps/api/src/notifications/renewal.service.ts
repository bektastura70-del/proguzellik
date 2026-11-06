import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { loadEnv, renewalAvailable, renewalRemindersOn, webPushMode } from "../config/env";
import { toZoned, zonedTime } from "../common/time";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { effectivePwa } from "../pwa/pwa-settings";
import { NotificationQueue } from "./notification-queue";
import { RENEWAL_TEMPLATE, RenewalRef, sign } from "./renewal-checks";

export { RENEWAL_TEMPLATE, renewalOptOutToken } from "./renewal-checks";

/** Gece görevinin planladığı hatırlatmalar müşteriye en erken bu saatte (yerel) gider. */
const SEND_AT_MIN = 11 * 60;
const DAY = 86_400_000;
/** Panel listesinde yenileme tarihi bu kadar gün geçmiş müşteriler de görünür (telefonla aranabilsin). */
const LIST_OVERDUE_DAYS = 30;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Bir müşterinin bir hizmetteki yenileme döngüsü: son tamamlanan işlem + tekrar süresi. */
export interface RenewalCycle {
  appointmentId: string;
  lastDoneAt: Date;
  dueDay: string;
  remindDay: string | null;
  customer: { id: string; firstName: string; lastName: string; phone: string | null; email: string | null; marketingConsent: boolean; renewalRemindersOptOutAt: Date | null; anonymizedAt: Date | null };
  service: { id: string; name: string; rebookAfterDays: number; renewalRemindDaysBefore: number | null };
  upcoming: { id: string; startsAt: Date } | null;
  portalIdentityId: string | null;
}

/**
 * Hizmeti tekrar süresi tanımlı her müşterinin son tamamlanan işlemine göre yenileme döngüleri.
 * Yalnızca yenileme günü [from, to] aralığında olanlar döner.
 */
async function cycles(tx: Tx, tz: string, from: string, to: string): Promise<RenewalCycle[]> {
  const services = await tx.service.findMany({
    where: { isActive: true, rebookAfterDays: { not: null } },
    select: { id: true, name: true, rebookAfterDays: true, renewalRemindDaysBefore: true },
  });
  const out: RenewalCycle[] = [];
  const now = new Date();
  for (const s of services) {
    const rebook = s.rebookAfterDays!;
    // Son işlem günü [from - rebook, to - rebook] aralığında olmalı (1 gün pay: saat dilimi farkı)
    const lo = zonedTime(addDays(from, -rebook - 1), 0, tz);
    const hi = zonedTime(addDays(to, -rebook + 1), 0, tz);
    const last = await tx.appointment.findMany({
      where: { serviceId: s.id, status: "COMPLETED" },
      orderBy: { startsAt: "desc" },
      distinct: ["customerId"],
      select: {
        id: true, startsAt: true, portalIdentityId: true,
        customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true, marketingConsent: true, renewalRemindersOptOutAt: true, anonymizedAt: true } },
      },
    });
    for (const a of last) {
      if (a.startsAt < lo || a.startsAt >= hi) continue;
      const dueDay = addDays(toZoned(a.startsAt, tz).date, rebook);
      if (dueDay < from || dueDay > to) continue;
      const upcoming = await tx.appointment.findFirst({
        where: { customerId: a.customer.id, serviceId: s.id, status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { gt: now } },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true },
      });
      out.push({
        appointmentId: a.id, lastDoneAt: a.startsAt, dueDay,
        remindDay: s.renewalRemindDaysBefore ? addDays(dueDay, -s.renewalRemindDaysBefore) : null,
        customer: a.customer, service: { ...s, rebookAfterDays: rebook }, upcoming, portalIdentityId: a.portalIdentityId,
      });
    }
  }
  return out.sort((x, y) => x.dueDay.localeCompare(y.dueDay));
}

/** Ticari ileti izni ve vazgeçme durumuna göre bu müşteriye hatırlatma gönderilebilir mi? */
const consentOk = (c: RenewalCycle["customer"]) => c.marketingConsent && !c.renewalRemindersOptOutAt && !c.anonymizedAt;

/**
 * Yenilenme hatırlatması: hizmetin tekrar süresi (rebookAfterDays) dolmadan, renewalRemindDaysBefore gün önce
 * müşteriye uygulama bildirimi (Web Push, salon uygulamasına giriş yapmışsa) ve e-posta.
 *  - Ortam (RENEWAL_REMINDERS=1) ve işletme ayarı (renewalRemindersEnabled) birlikte açık olmalı; varsayılan kapalı.
 *  - Yalnızca ticari ileti izni olan (marketingConsent) ve vazgeçmemiş müşterilere gider.
 *  - Bildirim kaydı benzersiz anahtarla (yenile:<son işlem>:<kanal>) bir kez planlanır; gece görevi tekrar çalışsa da çift gönderim olmaz.
 *  - Gönderim anında her koşul yeniden denetlenir (renewalSkipReason): bu arada randevu alındıysa, yeni işlem yapıldıysa,
 *    müşteri vazgeçtiyse ya da tarih geçtiyse gönderilmez.
 */
@Injectable()
export class RenewalService {
  private readonly logger = new Logger("Renewal");

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationQueue,
    private readonly audit: AuditService,
  ) {}

  async run(now = new Date()) {
    if (!renewalRemindersOn(loadEnv())) return { renewalReminders: 0, errors: [] as string[] };
    const tenants = await this.prisma.platform.tenant.findMany({ where: { status: { in: ["TRIAL", "ACTIVE"] }, renewalRemindersEnabled: true, renewalRemindersAllowed: true }, select: { id: true } });
    let renewalReminders = 0;
    const errors: string[] = [];
    for (const { id } of tenants) {
      try {
        renewalReminders += await this.forTenant(id, now);
      } catch (e) {
        errors.push(`renewal ${id}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return { renewalReminders, errors };
  }

  /** Bir işletme için bugün hatırlatma zamanı gelmiş döngüleri planlar; planlanan bildirim sayısını döner. */
  async forTenant(tenantId: string, now = new Date()) {
    if (!renewalRemindersOn(loadEnv())) return 0;
    const created = await this.prisma.withTenant({ tenantId, userId: "" }, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, slug: true, timezone: true, renewalRemindersEnabled: true, renewalRemindersAllowed: true } });
      if (!tenant.renewalRemindersEnabled || !tenant.renewalRemindersAllowed) return [];
      const tz = tenant.timezone;
      const local = toZoned(now, tz);
      const today = local.date;
      const sendAt = local.minutes < SEND_AT_MIN ? zonedTime(today, SEND_AT_MIN, tz) : now;
      const pwa = await effectivePwa(tx, tenantId);
      const pushOn = pwa.webPushEnabled && pwa.customerBookingEnabled && webPushMode(loadEnv()) !== "off";

      // Yenileme günü bugünden sonra olan (en çok 60 gün ileri) döngüler; hatırlatma günü gelmiş olanlar planlanır.
      // Hatırlatma günü kaçırıldıysa (görev çalışmadıysa) yenileme gününe kadar telafi edilir; sonrasında gönderilmez.
      const rows = (await cycles(tx, tz, addDays(today, 1), addDays(today, 61))).filter((c) => c.remindDay && c.remindDay <= today && !c.upcoming && consentOk(c.customer));
      const data: Prisma.NotificationCreateManyInput[] = [];
      for (const c of rows) {
        const ref: RenewalRef = { sourceAppointmentId: c.appointmentId, serviceId: c.service.id, customerId: c.customer.id, dueDay: c.dueDay };
        const base = { tenantId, template: RENEWAL_TEMPLATE, kind: "MARKETING", customerId: c.customer.id, scheduledFor: sendAt };
        if (c.customer.email) {
          data.push({ ...base, channel: "EMAIL", recipient: c.customer.email.trim().toLowerCase(), dedupeKey: `yenile:${c.appointmentId}:EMAIL`, payload: { renewal: ref } as unknown as Prisma.InputJsonValue });
        }
        if (pushOn) {
          const or: Prisma.CustomerIdentityWhereInput[] = [];
          if (c.portalIdentityId) or.push({ id: c.portalIdentityId });
          if (c.customer.email) or.push({ email: c.customer.email.trim().toLowerCase() });
          const ids = or.length ? await tx.customerIdentity.findMany({ where: { OR: or }, select: { id: true } }) : [];
          const dueAt = zonedTime(c.dueDay, 0, tz).toISOString();
          for (const { id } of ids) {
            data.push({
              ...base, channel: "WEBPUSH", recipient: `identity:${id}`, dedupeKey: `yenile:${c.appointmentId}:WEBPUSH:${id}`,
              // Kilit ekranında görünebilir: müşteri adı ve hizmet adı yazılmaz.
              payload: {
                title: tenant.name, body: "Yenileme zamanınız yaklaşıyor. Size uygun bir saat için randevu alabilirsiniz.",
                url: `/r/${tenant.slug}/uygulama`, tag: `yenile-${c.appointmentId}`, startsAt: dueAt, pref: "reminders", requireActive: false, expiresAt: dueAt,
                renewal: ref,
              } as unknown as Prisma.InputJsonValue,
            });
          }
        }
      }
      if (!data.length) return [];
      // Daha önce planlanmış (gönderilmiş/atlanmış dahil) olanlar yeniden planlanmaz.
      const existing = new Set((await tx.notification.findMany({ where: { dedupeKey: { in: data.map((d) => d.dedupeKey!) } }, select: { dedupeKey: true } })).map((n) => n.dedupeKey));
      const fresh = data.filter((d) => !existing.has(d.dedupeKey!));
      if (!fresh.length) return [];
      await tx.notification.createMany({ data: fresh, skipDuplicates: true });
      return tx.notification.findMany({ where: { dedupeKey: { in: fresh.map((d) => d.dedupeKey!) }, status: "QUEUED" }, select: { id: true, scheduledFor: true } });
    });
    for (const n of created) await this.queue.enqueue(n.id, n.scheduledFor).catch((e) => this.logger.error(`Kuyruğa eklenemedi: ${(e as Error).message}`));
    return created.length;
  }

  /** Salon paneli: yenilenmesi yaklaşan (ve yakın zamanda geçmiş) müşteriler. */
  async list(ctx: { tenantId: string; userId: string }, days: number) {
    return this.prisma.withTenant(ctx, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { timezone: true, renewalRemindersEnabled: true, renewalRemindersAllowed: true } });
      if (!renewalAvailable(tenant)) throw new NotFoundException("Bu özellik açık değil");
      const today = toZoned(new Date(), tenant.timezone).date;
      const rows = await cycles(tx, tenant.timezone, addDays(today, -LIST_OVERDUE_DAYS), addDays(today, days));
      const keys = rows.map((r) => `yenile:${r.appointmentId}:`);
      const sent = keys.length
        ? await tx.notification.findMany({
            where: { template: RENEWAL_TEMPLATE, OR: keys.map((k) => ({ dedupeKey: { startsWith: k } })) },
            select: { dedupeKey: true, channel: true, status: true, sentAt: true, scheduledFor: true, error: true },
          })
        : [];
      return {
        enabled: tenant.renewalRemindersEnabled,
        today,
        items: rows.map((r) => {
          const mine = sent.filter((n) => n.dedupeKey!.startsWith(`yenile:${r.appointmentId}:`));
          const reminder = !r.remindDay
            ? "NOT_CONFIGURED"
            : r.customer.anonymizedAt
              ? "ANONYMIZED"
              : r.customer.renewalRemindersOptOutAt
                ? "OPTED_OUT"
                : !r.customer.marketingConsent
                  ? "NO_CONSENT"
                  : mine.some((n) => n.status === "SENT")
                    ? "SENT"
                    : mine.some((n) => n.status === "QUEUED")
                      ? "SCHEDULED"
                      : r.upcoming
                        ? "BOOKED"
                        : mine.length
                          ? "SKIPPED"
                          : r.remindDay > today
                            ? "WAITING"
                            : r.dueDay <= today
                              ? "OVERDUE"
                              : "PENDING";
          return {
            customer: r.customer.anonymizedAt
              ? { id: r.customer.id, name: "Anonim müşteri", phone: null, email: null }
              : { id: r.customer.id, name: `${r.customer.firstName} ${r.customer.lastName}`, phone: r.customer.phone, email: r.customer.email },
            service: { id: r.service.id, name: r.service.name, rebookAfterDays: r.service.rebookAfterDays },
            lastDoneAt: r.lastDoneAt,
            dueDay: r.dueDay,
            remindDay: r.remindDay,
            daysLeft: Math.round((Date.parse(r.dueDay) - Date.parse(today)) / DAY),
            upcoming: r.upcoming,
            reminder,
            channels: mine.map((n) => ({ channel: n.channel, status: n.status, sentAt: n.sentAt, scheduledFor: n.scheduledFor })),
          };
        }),
      };
    });
  }

  /** E-postadaki bağlantıyla vazgeçme (herkese açık, imzalı belirteç). */
  async optOut(token: string) {
    const [tenantId, customerId, sig] = token.split(".");
    const uuid = /^[0-9a-f-]{36}$/;
    const ok = (() => {
      if (!uuid.test(tenantId ?? "") || !uuid.test(customerId ?? "") || !sig) return false;
      const a = Buffer.from(sig);
      const b = Buffer.from(sign(tenantId, customerId));
      return a.length === b.length && timingSafeEqual(a, b);
    })();
    if (!ok) throw new BadRequestException("Bağlantı geçersiz");
    return this.prisma.withTenant({ tenantId, userId: "" }, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const c = await tx.customer.findUnique({ where: { id: customerId }, select: { renewalRemindersOptOutAt: true } });
      if (!tenant || !c) throw new BadRequestException("Bağlantı geçersiz");
      if (!c.renewalRemindersOptOutAt) {
        await tx.customer.update({ where: { id: customerId }, data: { renewalRemindersOptOutAt: new Date() } });
        await this.audit.log(tx, { tenantId, action: "customer.consent_changed", entity: "Customer", entityId: customerId, metadata: { renewalRemindersOptOut: { from: false, to: true }, via: "email_link" } });
      }
      return { ok: true, salon: tenant.name };
    });
  }
}
