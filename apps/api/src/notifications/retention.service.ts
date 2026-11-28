import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { toZoned, zonedTime } from "../common/time";
import { loadEnv, renewalRemindersOn } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationQueue } from "./notification-queue";
import { whatsappDeliverable } from "./whatsapp-deliverable";
import { WhatsAppProvider } from "./whatsapp.provider";

/** Gece çalışan görevin planladığı mesajlar müşteriye en erken bu saatte (yerel) gider. */
const SEND_AT_MIN = 11 * 60;
/** "Tekrar randevu" yalnızca son 30 günde vadesi gelenler için (çok eski müşteriler rahatsız edilmez). */
const REBOOK_WINDOW_DAYS = 30;

/**
 * Müşteriyi geri getiren hizmet bildirimleri (günlük görevde):
 *  - Süreli paketin bitişine `packageReminderDays` kala, kalan seans varsa "paket_hatirlatma"
 *  - Hizmette tanımlı `rebookAfterDays` dolunca ve ileri tarihli randevu yoksa "tekrar_randevu"
 * Her bildirim benzersiz bir anahtarla (dedupeKey) bir kez planlanır; görev tekrar çalışırsa çift mesaj gitmez.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger("Retention");

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NotificationQueue,
    private readonly whatsapp: WhatsAppProvider,
  ) {}

  async run(now = new Date()) {
    const tenants = await this.prisma.platform.tenant.findMany({
      where: { status: { in: ["TRIAL", "ACTIVE"] }, plan: { features: { has: "WHATSAPP" } } },
      select: { id: true },
    });
    let packageReminders = 0;
    let rebookReminders = 0;
    const errors: string[] = [];
    for (const { id } of tenants) {
      try {
        const r = await this.forTenant(id, now);
        packageReminders += r.packages;
        rebookReminders += r.rebook;
      } catch (e) {
        errors.push(`retention ${id}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return { packageReminders, rebookReminders, errors };
  }

  async forTenant(tenantId: string, now = new Date()) {
    const created: { id: string; at: Date }[] = [];
    const counts = await this.prisma.withTenant({ tenantId, userId: "" }, async (tx) => {
      // WhatsApp bağlı değilse paket/tekrar randevu WhatsApp hatırlatması planlanmaz (atlanan kayıt oluşmaz).
      if (!(await whatsappDeliverable(tx, tenantId, this.whatsapp))) return { packages: 0, rebook: 0 };
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, timezone: true, packageReminderDays: true, renewalRemindersEnabled: true, renewalRemindersAllowed: true } });
      const tz = tenant.timezone;
      const local = toZoned(now, tz);
      const sendAt = local.minutes < SEND_AT_MIN ? zonedTime(local.date, SEND_AT_MIN, tz) : now;
      const fmtDate = (d: Date) => new Intl.DateTimeFormat("tr-TR", { timeZone: tz, day: "numeric", month: "long" }).format(d);
      const add = async (data: Omit<Prisma.NotificationUncheckedCreateInput, "tenantId" | "scheduledFor">) => {
        try {
          // Kayıt bir alt transaction noktasında denenir: çift kayıt hatası bütün işlemi bozmasın.
          await tx.$executeRaw`SAVEPOINT retention_add`;
          const n = await tx.notification.create({ data: { ...data, tenantId, scheduledFor: sendAt } });
          await tx.$executeRaw`RELEASE SAVEPOINT retention_add`;
          created.push({ id: n.id, at: sendAt });
          return 1;
        } catch (e) {
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT retention_add`;
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return 0;
          throw e;
        }
      };

      let packages = 0;
      const horizon = new Date(now.getTime() + tenant.packageReminderDays * 86_400_000);
      const pkgs = await tx.customerPackage.findMany({
        where: { status: "ACTIVE", expiresAt: { gt: now, lte: horizon } },
        include: { customer: true, appointments: { where: { status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { gt: now } }, select: { id: true } } },
      });
      for (const p of pkgs) {
        const remaining = p.totalSessions - p.usedSessions;
        if (remaining <= 0 || p.appointments.length > 0 || !p.customer.phone || p.customer.anonymizedAt) continue;
        packages += await add({
          recipient: p.customer.phone,
          template: "paket_hatirlatma",
          payload: { params: [p.customer.firstName, p.name, fmtDate(p.expiresAt!), String(remaining), tenant.name] },
          customerId: p.customerId,
          dedupeKey: `paket:${p.id}:${p.expiresAt!.toISOString().slice(0, 10)}`,
        });
      }

      let rebook = 0;
      // Yenilenme hatırlatması açık işletmede eski (süre dolduktan sonra WhatsApp) mesaj gönderilmez: müşteri iki kez rahatsız edilmesin.
      const renewalOn = renewalRemindersOn(loadEnv()) && tenant.renewalRemindersAllowed && tenant.renewalRemindersEnabled;
      const services = renewalOn ? [] : await tx.service.findMany({ where: { isActive: true, rebookAfterDays: { not: null } }, select: { id: true, name: true, rebookAfterDays: true } });
      for (const s of services) {
        const due = new Date(now.getTime() - s.rebookAfterDays! * 86_400_000);
        const oldest = new Date(due.getTime() - REBOOK_WINDOW_DAYS * 86_400_000);
        // Her müşterinin bu hizmetteki son tamamlanan randevusu
        const last = await tx.appointment.findMany({
          where: { serviceId: s.id, status: "COMPLETED" },
          orderBy: { startsAt: "desc" },
          distinct: ["customerId"],
          include: { customer: true },
        });
        for (const a of last) {
          if (a.startsAt > due || a.startsAt <= oldest) continue;
          if (!a.customer.phone || a.customer.anonymizedAt) continue;
          const upcoming = await tx.appointment.count({ where: { customerId: a.customerId, serviceId: s.id, status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { gt: now } } });
          if (upcoming > 0) continue;
          const days = Math.floor((now.getTime() - a.startsAt.getTime()) / 86_400_000);
          rebook += await add({
            recipient: a.customer.phone,
            template: "tekrar_randevu",
            payload: { params: [a.customer.firstName, s.name, String(days), tenant.name] },
            customerId: a.customerId,
            dedupeKey: `tekrar:${a.id}`,
          });
        }
      }
      return { packages, rebook };
    });
    for (const n of created) await this.queue.enqueue(n.id, n.at).catch((e) => this.logger.error(`Kuyruğa eklenemedi: ${(e as Error).message}`));
    return counts;
  }
}

