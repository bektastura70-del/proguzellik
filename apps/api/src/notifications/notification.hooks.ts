import { Injectable, Logger } from "@nestjs/common";
import { AppointmentStatus } from "@prisma/client";
import { AppointmentHooks } from "../appointments/appointments.service";
import { Tx } from "../prisma/prisma.service";
import { NotificationQueue } from "./notification-queue";
import { TemplateName } from "./whatsapp.provider";

const REMINDER_HOURS = 24;

/**
 * Randevu olaylarında WhatsApp bildirimleri planlar.
 * Kayıtlar randevuyla aynı transaction'da yazılır; gönderim BullMQ işçisindedir.
 */
@Injectable()
export class NotificationHooks extends AppointmentHooks {
  private readonly logger = new Logger("NotificationHooks");

  constructor(private readonly queue: NotificationQueue) {
    super();
  }

  private async context(tx: Tx, appointmentId: string) {
    const appt = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: { customer: true, service: true },
    });
    if (!appt) return null;
    const tenant = await tx.tenant.findUnique({ where: { id: appt.tenantId }, include: { plan: true } });
    if (!tenant || !tenant.plan.features.includes("WHATSAPP") || !appt.customer.phone) return null;
    const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("tr-TR", { timeZone: tenant.timezone, ...o }).format(appt.startsAt);
    const params = [
      appt.customer.firstName,
      tenant.name,
      appt.service.name,
      fmt({ day: "numeric", month: "long", weekday: "long" }),
      fmt({ hour: "2-digit", minute: "2-digit" }),
    ];
    return { appt, tenant, params, phone: appt.customer.phone };
  }

  private async schedule(tx: Tx, c: NonNullable<Awaited<ReturnType<NotificationHooks["context"]>>>, template: TemplateName, at: Date) {
    // startsAt: gönderim anında randevu saati değişmişse eski hatırlatma gönderilmez.
    const n = await tx.notification.create({
      data: {
        tenantId: c.tenant.id, recipient: c.phone, template, payload: { params: c.params, startsAt: c.appt.startsAt.toISOString() },
        appointmentId: c.appt.id, scheduledFor: at, customerId: c.appt.customerId,
      },
    });
    // Kuyruğa ekleme hatası randevuyu engellememeli.
    await this.queue.enqueue(n.id, at).catch((e) => this.logger.error(`Kuyruğa eklenemedi: ${(e as Error).message}`));
  }

  private async scheduleReminder(tx: Tx, c: NonNullable<Awaited<ReturnType<NotificationHooks["context"]>>>) {
    const reminderAt = new Date(c.appt.startsAt.getTime() - REMINDER_HOURS * 3_600_000);
    if (reminderAt.getTime() > Date.now() + 3_600_000) await this.schedule(tx, c, "randevu_hatirlatma", reminderAt);
  }

  async onCreated(tx: Tx, appt: { id: string }) {
    const c = await this.context(tx, appt.id);
    if (!c) return;
    await this.schedule(tx, c, "randevu_onay", new Date());
    await this.scheduleReminder(tx, c);
  }

  /** Saat değişince eski hatırlatma iptal edilir, yeni saate göre yeniden planlanır. */
  async onRescheduled(tx: Tx, appt: { id: string }, previous: { startsAt: Date }) {
    await tx.notification.updateMany({
      where: { appointmentId: appt.id, status: "QUEUED", template: "randevu_hatirlatma" },
      data: { status: "SKIPPED", error: "Randevu saati değişti" },
    });
    const c = await this.context(tx, appt.id);
    if (!c || c.appt.startsAt.getTime() === previous.startsAt.getTime()) return;
    await this.scheduleReminder(tx, c);
  }

  async onStatusChanged(tx: Tx, appt: { id: string; status: AppointmentStatus }) {
    if (appt.status !== "CANCELLED") return;
    await tx.notification.updateMany({ where: { appointmentId: appt.id, status: "QUEUED" }, data: { status: "SKIPPED" } });
    const c = await this.context(tx, appt.id);
    if (c && c.appt.startsAt > new Date()) await this.schedule(tx, c, "randevu_iptal", new Date());
  }
}
