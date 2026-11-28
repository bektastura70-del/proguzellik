import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { bookingCancelPath } from "../common/booking-token";
import { appUrl, loadEnv } from "../config/env";
import { fullAddress } from "../directory/address";
import { EmailTemplate } from "../email/templates";
import { Tx } from "../prisma/prisma.service";
import { BOOKING_EMAIL, CUSTOMER_CANCEL_MIN_HOURS } from "./booking-email.constants";
import { NotificationQueue } from "./notification-queue";

const DESK = ["OWNER", "MANAGER", "RECEPTION"];

const SOURCE_TR: Record<string, string> = {
  ONLINE: "online randevu sayfasından",
  WHATSAPP: "WhatsApp üzerinden",
  INSTAGRAM: "Instagram üzerinden",
};

/**
 * Müşterinin kendi aldığı/iptal ettiği randevular için e-posta bildirimleri.
 * WhatsApp ya da salon uygulaması (PWA) bayraklarına bağlı değildir: işletme yetkilileri (sahip, yönetici,
 * resepsiyon) ve randevuya atanan personel her durumda e-posta alır; online formda e-posta verildiyse kişiye onay + iptal bağlantısı gider.
 * Kayıtlar randevuyla aynı transaction'da yazılır, gönderim kuyruktadır (SMTP hatası randevuyu engellemez).
 */
@Injectable()
export class BookingEmailPlanner {
  private readonly logger = new Logger("BookingEmailPlanner");

  constructor(private readonly queue: NotificationQueue) {}

  private async load(tx: Tx, appointmentId: string) {
    const appt = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true, tenantId: true, startsAt: true, status: true, source: true, notes: true, customerId: true,
        customer: { select: { firstName: true, lastName: true, phone: true, email: true, anonymizedAt: true } },
        service: { select: { name: true } },
        staff: { select: { displayName: true, userId: true } },
      },
    });
    if (!appt) return null;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: appt.tenantId }, select: { name: true, slug: true, timezone: true, phone: true, address: true, neighborhood: true } });
    const when = new Intl.DateTimeFormat("tr-TR", { timeZone: tenant.timezone, day: "numeric", month: "long", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(appt.startsAt);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(appt.startsAt);
    return { appt, tenant, when, day };
  }

  /** Bildirim alacak işletme kullanıcıları: masa rolleri + atanan personel; tercihte kapatanlar hariç. */
  private async staffRecipients(tx: Tx, tenantId: string, assignedUserId: string | null, pref: "newAppointments" | "cancellations") {
    const members = await tx.membership.findMany({
      where: { tenantId, isActive: true, user: { isActive: true } },
      select: { userId: true, role: true, user: { select: { email: true } } },
    });
    const picked = members.filter((m) => DESK.includes(m.role) || m.userId === assignedUserId);
    if (!picked.length) return [];
    const prefs = await tx.userNotificationPreference.findMany({ where: { tenantId, userId: { in: picked.map((m) => m.userId) } } });
    return picked.filter((m) => {
      const p = prefs.find((x) => x.userId === m.userId);
      // "Yeni randevular" tercihi masa rolleri içindir; atanan personel "Bana atanan randevular" tercihine bakar.
      if (!p) return true;
      if (pref === "newAppointments" && !DESK.includes(m.role)) return p.assignments;
      return p[pref];
    });
  }

  private async write(tx: Tx, tenantId: string, rows: { recipient: string; template: string; dedupeKey: string; appointmentId: string; customerId?: string; email: EmailTemplate }[]) {
    if (!rows.length) return;
    await tx.notification.createMany({
      data: rows.map((r) => ({
        tenantId, channel: "EMAIL", recipient: r.recipient, template: r.template, kind: "SERVICE",
        payload: { email: r.email } as unknown as Prisma.InputJsonValue,
        appointmentId: r.appointmentId, customerId: r.customerId ?? null, scheduledFor: new Date(), dedupeKey: r.dedupeKey,
      })),
      skipDuplicates: true,
    });
    const created = await tx.notification.findMany({ where: { tenantId, dedupeKey: { in: rows.map((r) => r.dedupeKey) }, status: "QUEUED" }, select: { id: true, scheduledFor: true } });
    for (const n of created) await this.queue.enqueue(n.id, n.scheduledFor).catch((e) => this.logger.error(`Kuyruğa eklenemedi: ${(e as Error).message}`));
  }

  /** Müşteri (online sayfa, salon uygulaması, WhatsApp/Instagram yapay zekâsı) randevu aldı. */
  async created(tx: Tx, appointmentId: string) {
    const c = await this.load(tx, appointmentId);
    if (!c || !["BOOKED", "CONFIRMED"].includes(c.appt.status)) return;
    const { appt, tenant, when, day } = c;
    const base = appUrl(loadEnv());
    const customer = appt.customer.anonymizedAt ? "Müşteri" : `${appt.customer.firstName} ${appt.customer.lastName}`;
    const users = await this.staffRecipients(tx, appt.tenantId, appt.staff.userId, "newAppointments");
    const rows: Parameters<BookingEmailPlanner["write"]>[2] = users.map((u) => ({
      recipient: u.user.email,
      template: BOOKING_EMAIL.staffNew,
      dedupeKey: `ep:yeni:${appt.id}:u:${u.userId}`,
      appointmentId: appt.id,
      email: {
        name: "booking_new_staff",
        vars: {
          salon: tenant.name, customer, phone: appt.customer.phone ?? undefined, service: appt.service.name, staff: appt.staff.displayName,
          when, source: SOURCE_TR[appt.source] ?? "online", notes: appt.notes ?? undefined,
          link: `${base}/panel/takvim?tarih=${day}&randevu=${appt.id}`,
        },
      },
    }));
    await this.write(tx, appt.tenantId, rows);
  }

  /**
   * Online sayfa / salon uygulamasından randevu alan kişiye onay ve iptal bağlantısı.
   * Adres, formda bu randevu için yazılan e-postadır (telefonla eşleşen eski müşteri kaydına yazılmaz).
   * WhatsApp/Instagram'da müşteri yanıtı zaten konuşmada alır; orada çağrılmaz.
   */
  async customerConfirmation(tx: Tx, appointmentId: string, email: string | null | undefined) {
    const to = email?.trim().toLowerCase();
    if (!to) return;
    const c = await this.load(tx, appointmentId);
    if (!c || !["BOOKED", "CONFIRMED"].includes(c.appt.status)) return;
    const { appt, tenant, when } = c;
    const loc = await tx.salonListing.findUnique({ where: { tenantId: appt.tenantId }, select: { provinceCode: true, districtCode: true } });
    await this.write(tx, appt.tenantId, [
      {
        recipient: to,
        template: BOOKING_EMAIL.customerConfirm,
        dedupeKey: `ep:musteri-onay:${appt.id}`,
        appointmentId: appt.id,
        customerId: appt.customerId,
        email: {
          name: "booking_confirmation_customer",
          vars: {
            salon: tenant.name, firstName: appt.customer.firstName, service: appt.service.name, staff: appt.staff.displayName, when,
            address: fullAddress(tenant.address, tenant.neighborhood, loc) ?? undefined, phone: tenant.phone ?? undefined,
            cancelLink: `${appUrl(loadEnv())}${bookingCancelPath(tenant.slug, appt.id)}`, cancelHours: CUSTOMER_CANCEL_MIN_HOURS,
          },
        },
      },
    ]);
  }

  /** Müşteri randevusunu kendisi iptal etti. */
  async cancelledByCustomer(tx: Tx, appointmentId: string) {
    const c = await this.load(tx, appointmentId);
    if (!c || c.appt.startsAt <= new Date()) return;
    const { appt, tenant, when, day } = c;
    const customer = appt.customer.anonymizedAt ? "Müşteri" : `${appt.customer.firstName} ${appt.customer.lastName}`;
    const users = await this.staffRecipients(tx, appt.tenantId, appt.staff.userId, "cancellations");
    await this.write(
      tx,
      appt.tenantId,
      users.map((u) => ({
        recipient: u.user.email,
        template: BOOKING_EMAIL.staffCancel,
        dedupeKey: `ep:iptal:${appt.id}:u:${u.userId}`,
        appointmentId: appt.id,
        email: {
          name: "booking_cancelled_staff",
          vars: { salon: tenant.name, customer, phone: appt.customer.phone ?? undefined, service: appt.service.name, staff: appt.staff.displayName, when, link: `${appUrl(loadEnv())}/panel/takvim?tarih=${day}` },
        },
      })),
    );
  }
}
