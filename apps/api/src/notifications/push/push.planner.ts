import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { loadEnv, webPushMode } from "../../config/env";
import { Tx } from "../../prisma/prisma.service";
import { effectivePwa, staffPushOn } from "../../pwa/pwa-settings";
import { NotificationQueue } from "../notification-queue";

export type ActorKind = "STAFF" | "CUSTOMER";
export type PushEvent = "created" | "confirmed" | "rescheduled" | "cancelled";

/** Push şablonları (Notification.template, kanal WEBPUSH) */
export const PUSH_TEMPLATES = {
  created: "push_randevu_olusturuldu",
  confirmed: "push_randevu_onaylandi",
  changed: "push_randevu_degisti",
  cancelled: "push_randevu_iptal",
  reminder24: "push_hatirlatma_24",
  reminder2: "push_hatirlatma_2",
  staffNew: "push_isletme_yeni_randevu",
  staffAssigned: "push_isletme_atama",
  staffCancel: "push_isletme_musteri_iptal",
  staffChange: "push_isletme_degisiklik",
  test: "push_deneme",
  staffConversation: "push_isletme_mesaj_bekliyor",
} as const;
export const PUSH_REMINDER_TEMPLATES: string[] = [PUSH_TEMPLATES.reminder24, PUSH_TEMPLATES.reminder2];
/** İptal bildirimleri randevu iptal edilmişken de gönderilir. */
export const PUSH_CANCEL_TEMPLATES: string[] = [PUSH_TEMPLATES.cancelled, PUSH_TEMPLATES.staffCancel];

/** Personel tercih sütunları */
type StaffPref = "newAppointments" | "assignments" | "cancellations" | "changes";
type StaffType = "new" | "assigned" | "cancel" | "change";
const STAFF_META: Record<StaffType, { pref: StaffPref; template: string; title: string; inApp: string }> = {
  new: { pref: "newAppointments", template: PUSH_TEMPLATES.staffNew, title: "Yeni online randevu", inApp: "appointment.new" },
  assigned: { pref: "assignments", template: PUSH_TEMPLATES.staffAssigned, title: "Size randevu atandı", inApp: "appointment.assigned" },
  cancel: { pref: "cancellations", template: PUSH_TEMPLATES.staffCancel, title: "Müşteri randevuyu iptal etti", inApp: "appointment.customer_cancelled" },
  change: { pref: "changes", template: PUSH_TEMPLATES.staffChange, title: "Randevu saati değişti", inApp: "appointment.changed" },
};
const DESK = ["OWNER", "MANAGER", "RECEPTION"];

/** Bildirim yükü: kilit ekranında görünebileceği için müşteri adı, telefon, e-posta ve hizmet adı içermez. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  startsAt: string;
  /** Gönderim anında yeniden denetlenen tercih */
  pref: "appointments" | "reminders" | StaffPref | "test" | "conversations";
  /** Randevu gönderim anında hâlâ planlı olmalı mı (iptal bildirimleri hariç) */
  requireActive: boolean;
  /** Hatırlatmalar randevu saatinden sonra cihaza ulaşmamalı */
  expiresAt?: string;
}

interface PlanRow {
  recipient: string; // "identity:<id>" | "user:<id>"
  template: string;
  dedupeKey: string;
  scheduledFor: Date;
  payload: PushPayload;
}

/**
 * Web Push ve uygulama içi bildirimlerin planlanması (Modül 3). Randevu transaction'ı içinde çalışır:
 * - Yalnızca createMany(skipDuplicates) kullanılır; benzersizlik çakışması transaction'ı bozmaz, randevuyu engellemez.
 * - Aynı olay iki kez planlanmaz (dedupeKey; saat değişikliklerinde yeni saat anahtara dahildir).
 * - Bayrak (web_push_enabled) veya ortam (WEB_PUSH_MODE) kapalıysa push kaydı yazılmaz.
 * - Gönderim BullMQ işçisindedir; tercih, bayrak ve randevu durumu gönderim anında yeniden denetlenir.
 */
@Injectable()
export class PushPlanner {
  private readonly logger = new Logger("PushPlanner");

  constructor(private readonly queue: NotificationQueue) {}

  async plan(tx: Tx, appointmentId: string, ev: PushEvent, by: ActorKind = "STAFF", opts: { actorId?: string; previous?: { startsAt: Date; staffId: string } } = {}) {
    const appt = await tx.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true, tenantId: true, startsAt: true, status: true, staffId: true, portalIdentityId: true, createdById: true,
        customer: { select: { firstName: true, lastName: true, email: true, anonymizedAt: true } },
        staff: { select: { userId: true } },
      },
    });
    if (!appt) return;
    // Oluşturma olayında işlemi yapan, randevuyu oluşturan kullanıcıdır (kendisine bildirim gitmez).
    if (ev === "created" && !opts.actorId && appt.createdById) opts = { ...opts, actorId: appt.createdById };
    const pwa = await effectivePwa(tx, appt.tenantId);
    const mode = webPushMode(loadEnv());
    const pushOn = pwa.webPushEnabled && mode !== "off";
    const customerPush = pushOn && pwa.customerBookingEnabled;
    // İşletme kullanıcılarına telefon bildirimi her işletmede (salon uygulaması pilotundan bağımsız).
    const staffPush = staffPushOn();
    // Panel içi bildirim (Bildirim merkezi + rozet) her işletmede yazılır; salon uygulaması bayrağına bağlı değildir.
    const inApp = true;
    if (!customerPush && !staffPush && !inApp) return;

    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: appt.tenantId }, select: { name: true, slug: true, timezone: true } });
    const when = new Intl.DateTimeFormat("tr-TR", { timeZone: tenant.timezone, day: "numeric", month: "long", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(appt.startsAt);
    const iso = appt.startsAt.toISOString();
    const rows: PlanRow[] = [];
    const inAppRows: Prisma.InAppNotificationCreateManyInput[] = [];

    // ---- Müşteri (salon uygulamasına e-posta koduyla giriş yapmış kimlik) ----
    if (customerPush) {
      const ids = await this.customerIdentities(tx, appt);
      if (ids.length) {
        const url = `/r/${tenant.slug}/uygulama?sekme=randevularim`;
        // Müşterinin kendi işlemi de bildirilir (talimat: oluşturuldu/değişti/iptal); kayıt telefonda kalsın diye.
        const own = by === "CUSTOMER";
        const ev2tpl: Partial<Record<PushEvent, [string, string]>> = {
          created: [PUSH_TEMPLATES.created, own ? `Randevunuz alındı: ${when}` : `Randevunuz oluşturuldu: ${when}`],
          confirmed: [PUSH_TEMPLATES.confirmed, `Randevunuz onaylandı: ${when}`],
          rescheduled: [PUSH_TEMPLATES.changed, `Randevunuz yeni saate alındı: ${when}`],
          cancelled: [PUSH_TEMPLATES.cancelled, `${when} tarihli randevunuz iptal edildi`],
        };
        const hit = ev2tpl[ev];
        for (const id of ids) {
          if (hit && (ev === "cancelled" || ["BOOKED", "CONFIRMED"].includes(appt.status))) {
            rows.push({
              recipient: `identity:${id}`, template: hit[0], scheduledFor: new Date(),
              dedupeKey: `wp:${hit[0]}:${appt.id}:i:${id}${ev === "cancelled" ? "" : `:${iso}`}`,
              payload: { title: tenant.name, body: hit[1], url, tag: `randevu-${appt.id}`, startsAt: iso, pref: "appointments", requireActive: ev !== "cancelled" },
            });
          }
          if ((ev === "created" || ev === "rescheduled") && ["BOOKED", "CONFIRMED"].includes(appt.status)) {
            for (const [hours, tpl] of [[24, PUSH_TEMPLATES.reminder24], [2, PUSH_TEMPLATES.reminder2]] as const) {
              const at = new Date(appt.startsAt.getTime() - hours * 3_600_000);
              // Çok yakın randevuda (ör. 1 saat sonra) 24 ve 2 saat hatırlatması anlamsızdır.
              if (at.getTime() < Date.now() + 5 * 60_000) continue;
              rows.push({
                recipient: `identity:${id}`, template: tpl, scheduledFor: at,
                dedupeKey: `wp:${tpl}:${appt.id}:i:${id}:${iso}`,
                payload: {
                  title: tenant.name,
                  body: hours === 24 ? `Yarın randevunuz var: ${when}` : `Randevunuza 2 saat kaldı: ${when}`,
                  url, tag: `hatirlatma-${appt.id}`, startsAt: iso, pref: "reminders", requireActive: true, expiresAt: iso,
                },
              });
            }
          }
        }
      }
    }

    // ---- İşletme (personel ve masa rolleri) ----
    if (staffPush || inApp) {
      const targets = await this.staffTargets(tx, appt, ev, by, opts);
      if (targets.length) {
        const prefs = await tx.userNotificationPreference.findMany({ where: { tenantId: appt.tenantId, userId: { in: targets.map((t) => t.userId) } } });
        const subs = staffPush
          ? new Set((await tx.pushSubscription.findMany({ where: { tenantId: appt.tenantId, audience: "STAFF", userId: { in: targets.map((t) => t.userId) }, revokedAt: null }, select: { userId: true } })).map((s) => s.userId))
          : new Set<string | null>();
        // Bildirime dokununca takvimde o gün açılır ve randevu kartı (onayla / reddet / başka saat) gösterilir.
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(appt.startsAt);
        const staffUrl = `/panel/takvim?gorunum=gun&tarih=${day}&randevu=${appt.id}`;
        const initial = appt.customer.anonymizedAt ? "Müşteri" : `${appt.customer.firstName} ${appt.customer.lastName.slice(0, 1)}.`;
        for (const t of targets) {
          const meta = STAFF_META[t.type];
          const p = prefs.find((x) => x.userId === t.userId);
          if (p && !p[meta.pref]) continue;
          const keyTail = `${appt.id}:u:${t.userId}${t.type === "cancel" ? "" : `:${iso}:${appt.staffId}`}`;
          if (inApp) {
            inAppRows.push({
              tenantId: appt.tenantId, audience: "STAFF", userId: t.userId, type: meta.inApp, title: meta.title,
              body: `${initial} · ${when}`, appointmentId: appt.id, dedupeKey: `ia:${t.type}:${keyTail}`,
            });
          }
          if (staffPush && subs.has(t.userId)) {
            rows.push({
              recipient: `user:${t.userId}`, template: meta.template, scheduledFor: new Date(), dedupeKey: `wp:${t.type}:${keyTail}`,
              payload: { title: meta.title, body: when, url: staffUrl, tag: `randevu-${appt.id}`, startsAt: iso, pref: meta.pref, requireActive: t.type !== "cancel" },
            });
          }
        }
      }
    }

    if (inAppRows.length) await tx.inAppNotification.createMany({ data: inAppRows, skipDuplicates: true });
    if (!rows.length) return;
    await tx.notification.createMany({
      data: rows.map((r) => ({
        tenantId: appt.tenantId, channel: "WEBPUSH", recipient: r.recipient, template: r.template, kind: "SERVICE",
        payload: r.payload as unknown as Prisma.InputJsonValue, appointmentId: appt.id, scheduledFor: r.scheduledFor, dedupeKey: r.dedupeKey,
      })),
      skipDuplicates: true,
    });
    const created = await tx.notification.findMany({ where: { tenantId: appt.tenantId, dedupeKey: { in: rows.map((r) => r.dedupeKey) }, status: "QUEUED" }, select: { id: true, scheduledFor: true } });
    for (const n of created) {
      await this.queue.enqueue(n.id, n.scheduledFor).catch((e) => this.logger.error(`Kuyruğa eklenemedi: ${(e as Error).message}`));
    }
  }

  /**
   * Personelin yanıtını bekleyen konuşma (yapay zekâ devretti, kanalda yapay zekâ kapalı ya da konuşma personelde):
   * masa rolleri (sahip, yönetici, resepsiyon) telefonlarında bildirim alır. İçerikte müşteri adı/mesajı yoktur.
   * Aynı müşteri mesajı için kişi başına bir kez planlanır; aynı etiket cihazdaki eski bildirimin yerini alır.
   */
  async planConversation(tx: Tx, conversationId: string) {
    const conv = await tx.conversation.findUnique({ where: { id: conversationId }, select: { id: true, tenantId: true, lastInboundAt: true } });
    if (!conv) return;
    if (!staffPushOn()) return;
    const desk = await tx.membership.findMany({ where: { tenantId: conv.tenantId, isActive: true, role: { in: DESK as never[] } }, select: { userId: true } });
    const subs = await tx.pushSubscription.findMany({
      where: { tenantId: conv.tenantId, audience: "STAFF", userId: { in: desk.map((d) => d.userId) }, revokedAt: null },
      select: { userId: true },
    });
    const users = [...new Set(subs.map((x) => x.userId).filter((x): x is string => !!x))];
    if (!users.length) return;
    const stamp = (conv.lastInboundAt ?? new Date()).toISOString();
    const rows: PlanRow[] = users.map((userId) => ({
      recipient: `user:${userId}`,
      template: PUSH_TEMPLATES.staffConversation,
      scheduledFor: new Date(),
      dedupeKey: `wp:conv:${conv.id}:${stamp}:u:${userId}`,
      payload: {
        title: "Yanıt bekleyen konuşma",
        body: "Bir müşteri personel yanıtı bekliyor.",
        url: "/panel/mesajlar",
        tag: `konusma-${conv.id}`,
        startsAt: new Date().toISOString(),
        pref: "conversations",
        requireActive: false,
      },
    }));
    await tx.notification.createMany({
      data: rows.map((r) => ({
        tenantId: conv.tenantId, channel: "WEBPUSH", recipient: r.recipient, template: r.template, kind: "SERVICE",
        payload: r.payload as unknown as Prisma.InputJsonValue, scheduledFor: r.scheduledFor, dedupeKey: r.dedupeKey,
      })),
      skipDuplicates: true,
    });
    const created = await tx.notification.findMany({ where: { tenantId: conv.tenantId, dedupeKey: { in: rows.map((r) => r.dedupeKey) }, status: "QUEUED" }, select: { id: true, scheduledFor: true } });
    for (const n of created) {
      await this.queue.enqueue(n.id, n.scheduledFor).catch((e) => this.logger.error(`Kuyruğa eklenemedi: ${(e as Error).message}`));
    }
  }

  /** Randevuyu portalda görebilen kimlikler (portal.service mine() ile aynı kural). */
  private async customerIdentities(tx: Tx, appt: { tenantId: string; portalIdentityId: string | null; customer: { email: string | null; anonymizedAt: Date | null } }) {
    const or: Prisma.CustomerIdentityWhereInput[] = [];
    if (appt.portalIdentityId) or.push({ id: appt.portalIdentityId });
    if (appt.customer.email && !appt.customer.anonymizedAt) or.push({ email: appt.customer.email.trim().toLowerCase() });
    if (!or.length) return [];
    return (await tx.customerIdentity.findMany({ where: { tenantId: appt.tenantId, OR: or }, select: { id: true } })).map((i) => i.id);
  }

  /**
   * Hangi işletme kullanıcısı hangi bildirimi alır:
   *  - Müşteri online randevu aldı: masa rolleri "yeni randevu", atanan personel "size atandı"
   *  - Müşteri iptal etti / saat değiştirdi: masa rolleri ve atanan personel
   *  - Personel randevu oluşturdu / başka personele aktardı: atanan personel (işlemi yapan kişi hariç)
   *  - Personel saati değiştirdi: atanan personel (işlemi yapan kişi hariç)
   * Personel rolü yalnızca kendisine atanmış randevular için bildirim alır.
   */
  private async staffTargets(tx: Tx, appt: { tenantId: string; staff: { userId: string | null }; staffId: string }, ev: PushEvent, by: ActorKind, opts: { actorId?: string; previous?: { startsAt: Date; staffId: string } }) {
    const members = await tx.membership.findMany({ where: { tenantId: appt.tenantId, isActive: true }, select: { userId: true, role: true } });
    const assigned = appt.staff.userId && members.some((m) => m.userId === appt.staff.userId) ? appt.staff.userId : null;
    const desk = members.filter((m) => DESK.includes(m.role)).map((m) => m.userId);
    const out = new Map<string, StaffType>();
    const add = (userId: string | null | undefined, type: StaffType) => {
      if (!userId || userId === opts.actorId || out.has(userId)) return;
      out.set(userId, type);
    };
    if (by === "CUSTOMER") {
      if (ev === "created") {
        add(assigned, "assigned");
        desk.forEach((u) => add(u, "new"));
      } else if (ev === "cancelled") {
        add(assigned, "cancel");
        desk.forEach((u) => add(u, "cancel"));
      } else if (ev === "rescheduled") {
        add(assigned, "change");
        desk.forEach((u) => add(u, "change"));
      }
    } else if (ev === "created") {
      add(assigned, "assigned");
    } else if (ev === "rescheduled") {
      add(assigned, opts.previous && opts.previous.staffId !== appt.staffId ? "assigned" : "change");
    }
    return [...out].map(([userId, type]) => ({ userId, type }));
  }
}
