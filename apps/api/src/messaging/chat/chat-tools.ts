import { Injectable } from "@nestjs/common";
import { BookingSource, ChannelType, Prisma } from "@prisma/client";
import { z } from "zod";
import { AppointmentsService } from "../../appointments/appointments.service";
import { AvailabilityService } from "../../appointments/availability.service";
import { AuditService } from "../../audit/audit.service";
import { assertUsageLimit, UsageLimitError } from "../../billing/plan-pricing";
import { CampaignsService } from "../../campaigns/campaigns.service";
import { toZoned } from "../../common/time";
import { appUrl, loadEnv } from "../../config/env";
import { PrismaService, Tx } from "../../prisma/prisma.service";
import { phoneCandidates } from "../inbox.service";

const MAX_DAYS_AHEAD = 60;
const MAX_SLOTS = 12;
/** Müşterinin onay mesajı sayılan ifadeler (sunucu ayrıca kontrol eder; yapay zekânın yorumuna bırakılmaz). */
const AFFIRMATIVE = /\b(evet|onayl[ıi]yorum|onay|tamam|olur|kabul|uygun|ok(ey)?|ayarla|oluştur)\b/i;
/** "Hayır, tamam değil" gibi yanıtlar onay sayılmaz. */
const NEGATIVE = /(hay[ıi]r|istemiyorum|de[ğg]il|iptal|vazge[çc]|onaylam[ıi]yorum|olmaz)/i;
export const isAffirmative = (text: string) => AFFIRMATIVE.test(text) && !NEGATIVE.test(text);
const DAY = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

export interface ChatContext {
  tenantId: string;
  conversationId: string;
  channel: ChannelType;
  externalUserId: string;
  customerId: string | null;
}

/** Bekleyen randevu (müşteri onayı bekleniyor): konuşma durumunda tutulur. */
export interface PendingBooking {
  serviceId: string;
  staffId: string;
  startsAt: string;
  firstName: string;
  lastName: string;
  phone: string;
  createdAt: string;
}
export interface ChatState {
  pending?: PendingBooking;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  handoff?: string;
  booked?: string;
}

/** Yapay zekâya tanıtılan araçlar. Tüm veriler sunucuda, işletmenin kendi kayıtlarından okunur. */
export const TOOL_DEFS = [
  {
    name: "salon_bilgisi",
    description: "Salonun adı, adresi, telefonu ve haftalık çalışma saatleri. Açılış/kapanış, adres, iletişim sorularında kullan.",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "hizmetler",
    description: "Online randevuya açık hizmetler: kimlik, ad, süre (dk), fiyat (TL) ve açıklama. Fiyat ve hizmet sorularında YALNIZCA bu sonucu kullan.",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "kampanyalar",
    description: "Şu an geçerli kampanyalar. Kampanya/indirim sorularında YALNIZCA bunları anlat; listede yoksa kampanya olmadığını söyle.",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "bos_saatler",
    description: "Bir hizmet için belirli bir gündeki boş randevu saatleri (salon saat diliminde). Randevu önermeden önce mutlaka kullan.",
    input_schema: {
      type: "object" as const,
      properties: {
        hizmetId: { type: "string", description: "hizmetler aracındaki kimlik" },
        tarih: { type: "string", description: "YYYY-AA-GG" },
        personelId: { type: "string", description: "İsteğe bağlı; müşteri belirli bir personel isterse" },
      },
      required: ["hizmetId", "tarih"],
      additionalProperties: false,
    },
  },
  {
    name: "randevu_hazirla",
    description:
      "Müşteri bir saat seçip ad-soyad (Instagram'da ayrıca cep telefonu) verdikten sonra randevuyu HAZIRLAR, henüz oluşturmaz. Dönen özeti ve KVKK aydınlatma bağlantısını müşteriye gösterip açık onay iste.",
    input_schema: {
      type: "object" as const,
      properties: {
        hizmetId: { type: "string" },
        baslangic: { type: "string", description: "bos_saatler sonucundaki baslangicIso değeri" },
        personelId: { type: "string", description: "bos_saatler sonucundaki personelId" },
        ad: { type: "string" },
        soyad: { type: "string" },
        telefon: { type: "string", description: "Yalnızca Instagram'da gerekli: 05xx xxx xx xx" },
      },
      required: ["hizmetId", "baslangic", "personelId", "ad", "soyad"],
      additionalProperties: false,
    },
  },
  {
    name: "randevu_onayla",
    description: "Müşteri hazırlanan randevu özetine açıkça 'evet/onaylıyorum' dedikten SONRA randevuyu oluşturur. Müşteri onay vermeden çağırma.",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "musteri_randevulari",
    description: "Bu müşterinin ileri tarihli randevuları (yalnızca müşteri kaydı eşleşmişse).",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "personele_devret",
    description:
      "Konuşmayı salon personeline devreder ve yapay zekâ susar. Emin olmadığında, bilgi araçlarda yoksa, şikâyet, iptal/değişiklik, ödeme/iade, sağlık veya cilt sorunu, müşteri insanla görüşmek isterse kullan.",
    input_schema: {
      type: "object" as const,
      properties: { neden: { type: "string", description: "Personelin göreceği kısa neden" } },
      required: ["neden"],
      additionalProperties: false,
    },
  },
];

const slotsInput = z.object({ hizmetId: z.string().uuid(), tarih: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), personelId: z.string().uuid().optional() });
const prepareInput = z.object({
  hizmetId: z.string().uuid(),
  baslangic: z.string().datetime({ offset: true }),
  personelId: z.string().uuid(),
  ad: z.string().trim().min(2).max(60),
  soyad: z.string().trim().min(1).max(60),
  telefon: z.string().trim().optional(),
});
const handoffInput = z.object({ neden: z.string().trim().min(2).max(300) });

/** Türkiye cep telefonu: 05xxxxxxxxx biçimine getirir; geçersizse null. */
export function normalizeMobile(v: string) {
  const d = v.replace(/\D/g, "");
  const ten = d.startsWith("90") && d.length === 12 ? d.slice(2) : d.startsWith("0") && d.length === 11 ? d.slice(1) : d.length === 10 ? d : null;
  return ten && ten.startsWith("5") ? `0${ten}` : null;
}

const money = (v: Prisma.Decimal | number | string) => `${Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} TL`;

/**
 * Sohbet araçlarının sunucu tarafı. Yapay zekâ yalnızca bu araçlar üzerinden veri okur/yazar;
 * kurallar (boş saat, onay, KVKK, paket limitleri) burada uygulanır, modelin yorumuna bırakılmaz.
 */
@Injectable()
export class ChatTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly appointments: AppointmentsService,
    private readonly audit: AuditService,
  ) {}

  private tx<T>(c: ChatContext, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.withTenant({ tenantId: c.tenantId, userId: "" }, fn);
  }

  async run(c: ChatContext, name: string, input: unknown): Promise<ToolResult> {
    try {
      switch (name) {
        case "salon_bilgisi":
          return { ok: true, data: await this.salon(c) };
        case "hizmetler":
          return { ok: true, data: await this.services(c) };
        case "kampanyalar":
          return { ok: true, data: await this.tx(c, async (tx) => (await CampaignsService.active(tx)).map((k) => ({ baslik: k.title, aciklama: k.description, bitis: k.endsAt?.toISOString().slice(0, 10) ?? null }))) };
        case "bos_saatler":
          return await this.slots(c, slotsInput.parse(input));
        case "randevu_hazirla":
          return await this.prepare(c, prepareInput.parse(input));
        case "randevu_onayla":
          return await this.confirm(c);
        case "musteri_randevulari":
          return { ok: true, data: await this.myAppointments(c) };
        case "personele_devret":
          return { ok: true, handoff: handoffInput.parse(input).neden, data: "Konuşma personele devredildi. Müşteriye kısaca ekibin dönüş yapacağını söyle." };
        default:
          return { ok: false, error: "Bilinmeyen araç" };
      }
    } catch (e) {
      if (e instanceof z.ZodError) return { ok: false, error: `Geçersiz girdi: ${e.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}` };
      if (e instanceof UsageLimitError) return { ok: false, handoff: "İşletmenin paket limiti doldu; randevu oluşturulamadı", error: "Şu anda randevu oluşturulamıyor" };
      const msg = (e as Error).message ?? "Hata";
      if (msg.includes("appointment_no_overlap") || msg.includes("23P01")) return { ok: false, error: "Bu saat az önce doldu; bos_saatler ile başka saat öner" };
      return { ok: false, error: msg.slice(0, 200) };
    }
  }

  private async salon(c: ChatContext) {
    return this.tx(c, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { name: true, address: true, phone: true, timezone: true } });
      const hours = await tx.workingHour.findMany({ where: { staff: { isActive: true } }, select: { weekday: true, startMin: true, endMin: true } });
      const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const week = [1, 2, 3, 4, 5, 6, 0].map((d) => {
        const h = hours.filter((x) => x.weekday === d);
        return { gun: DAY[d], saat: h.length ? `${fmt(Math.min(...h.map((x) => x.startMin)))}–${fmt(Math.max(...h.map((x) => x.endMin)))}` : "Kapalı" };
      });
      return { ad: t.name, adres: t.address, telefon: t.phone, saatDilimi: t.timezone, calismaSaatleri: week };
    });
  }

  private services(c: ChatContext) {
    return this.tx(c, async (tx) =>
      (
        await tx.service.findMany({
          where: { isActive: true, onlineBookable: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, durationMin: true, price: true, description: true },
        })
      ).map((s) => ({ hizmetId: s.id, ad: s.name, sureDk: s.durationMin, fiyat: money(s.price), aciklama: s.description })),
    );
  }

  private async slots(c: ChatContext, b: z.infer<typeof slotsInput>) {
    const day = new Date(`${b.tarih}T00:00:00Z`).getTime();
    if (day > Date.now() + MAX_DAYS_AHEAD * 86_400_000) return { ok: false, error: `En fazla ${MAX_DAYS_AHEAD} gün sonrası için randevu verilebilir` };
    return this.tx(c, async (tx) => {
      const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { timezone: true } })).timezone;
      const slots = await this.availability.slots(tx, { tenantId: c.tenantId, date: b.tarih, serviceId: b.hizmetId, staffId: b.personelId, onlineOnly: true });
      const min = Date.now() + 60 * 60_000;
      const list = slots.filter((s) => new Date(s.startsAt).getTime() >= min);
      // Aynı saatte birden çok personel varsa ilk uygun olan önerilir.
      const seen = new Set<string>();
      const uniq = list.filter((s) => (seen.has(s.startsAt) ? false : (seen.add(s.startsAt), true))).slice(0, MAX_SLOTS);
      return {
        ok: true,
        data: {
          tarih: b.tarih,
          saatler: uniq.map((s) => {
            const m = toZoned(new Date(s.startsAt), tz).minutes;
            return { saat: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`, baslangicIso: s.startsAt, personelId: s.staffId, personel: s.staffName };
          }),
          not: uniq.length ? undefined : "Bu gün için boş saat yok; başka bir gün öner.",
        },
      };
    });
  }

  private async prepare(c: ChatContext, b: z.infer<typeof prepareInput>) {
    const phone = c.channel === "WHATSAPP" ? normalizeMobile(c.externalUserId) : b.telefon ? normalizeMobile(b.telefon) : null;
    if (!phone) return { ok: false, error: c.channel === "INSTAGRAM" ? "Geçerli bir cep telefonu (05xx...) iste" : "Telefon numarası doğrulanamadı; personele devret" };
    return this.tx(c, async (tx) => {
      const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { timezone: true, name: true } }));
      const service = await tx.service.findUnique({ where: { id: b.hizmetId } });
      if (!service || !service.isActive || !service.onlineBookable) return { ok: false, error: "Hizmet bulunamadı" };
      const local = toZoned(new Date(b.baslangic), tz.timezone);
      const slots = await this.availability.slots(tx, { tenantId: c.tenantId, date: local.date, serviceId: service.id, staffId: b.personelId, onlineOnly: true });
      const slot = slots.find((s) => s.startsAt === new Date(b.baslangic).toISOString());
      if (!slot || new Date(slot.startsAt).getTime() < Date.now() + 60 * 60_000) return { ok: false, error: "Bu saat artık müsait değil; bos_saatler ile yeniden bak" };
      const pending: PendingBooking = { serviceId: service.id, staffId: slot.staffId, startsAt: slot.startsAt, firstName: b.ad, lastName: b.soyad, phone, createdAt: new Date().toISOString() };
      await tx.conversation.update({ where: { id: c.conversationId }, data: { state: { pending } as unknown as Prisma.InputJsonValue } });
      const when = new Intl.DateTimeFormat("tr-TR", { timeZone: tz.timezone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(slot.startsAt));
      return {
        ok: true,
        data: {
          ozet: `${service.name} · ${when} · ${slot.staffName} · ${money(service.price)} · ${b.ad} ${b.soyad} · ${phone}`,
          kvkkBaglantisi: `${appUrl(loadEnv())}/kvkk`,
          talimat: "Özeti ve KVKK aydınlatma bağlantısını müşteriye göster; 'Bilgilerimin randevu için işlenmesini kabul ediyor ve randevuyu onaylıyor musunuz?' diye sor. Müşteri açıkça onaylarsa randevu_onayla aracını çağır.",
        },
      };
    });
  }

  private async confirm(c: ChatContext) {
    const result = await this.tx(c, async (tx) => {
      const conv = await tx.conversation.findUniqueOrThrow({ where: { id: c.conversationId } });
      const p = (conv.state as ChatState | null)?.pending;
      if (!p) return { ok: false, error: "Hazırlanmış randevu yok; önce randevu_hazirla" } as ToolResult;
      // Onay, özet hazırlandıktan SONRA müşterinin yazdığı mesajda açıkça olmalı.
      const reply = await tx.conversationMessage.findFirst({ where: { conversationId: conv.id, direction: "IN", createdAt: { gt: new Date(p.createdAt) } }, orderBy: { createdAt: "desc" } });
      if (!reply || !isAffirmative(reply.text)) return { ok: false, error: "Müşteri henüz açık onay vermedi; özeti gösterip onay iste" } as ToolResult;
      if (Date.now() - new Date(p.createdAt).getTime() > 30 * 60_000) {
        await tx.conversation.update({ where: { id: conv.id }, data: { state: Prisma.DbNull } });
        return { ok: false, error: "Hazırlanan randevunun süresi doldu; saati yeniden kontrol et" } as ToolResult;
      }
      let customer = conv.customerId ? await tx.customer.findUnique({ where: { id: conv.customerId } }) : null;
      if (customer?.anonymizedAt) customer = null;
      customer ??= await tx.customer.findFirst({ where: { phone: { in: phoneCandidates(p.phone) }, anonymizedAt: null } });
      if (!customer) {
        await assertUsageLimit(tx, c.tenantId, "customer");
        customer = await tx.customer.create({
          data: { tenantId: c.tenantId, firstName: p.firstName, lastName: p.lastName, phone: p.phone, source: c.channel, kvkkConsentAt: new Date(), marketingConsent: false },
        });
      } else if (!customer.kvkkConsentAt) {
        await tx.customer.update({ where: { id: customer.id }, data: { kvkkConsentAt: new Date() } });
      }
      const appt = await this.appointments.createInTx(tx, c.tenantId, {
        customerId: customer.id,
        staffId: p.staffId,
        serviceId: p.serviceId,
        startsAt: p.startsAt,
        source: c.channel as BookingSource,
        notes: `${c.channel === "WHATSAPP" ? "WhatsApp" : "Instagram"} üzerinden yapay zekâ asistanıyla alındı`,
      });
      await tx.conversation.update({ where: { id: conv.id }, data: { state: Prisma.DbNull, customerId: customer.id } });
      await this.audit.log(tx, { tenantId: c.tenantId, action: "booking.chat_created", entity: "Appointment", entityId: appt.id, metadata: { channel: c.channel, conversationId: conv.id } });
      return { ok: true, booked: appt.id, data: { durum: "Randevu oluşturuldu", randevuId: appt.id } } as ToolResult;
    });
    return result;
  }

  private myAppointments(c: ChatContext) {
    if (!c.customerId) return Promise.resolve({ not: "Müşteri kaydı eşleşmedi; randevu bilgisi verilemez." });
    return this.tx(c, async (tx) => {
      const tz = (await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { timezone: true } })).timezone;
      const rows = await tx.appointment.findMany({
        where: { customerId: c.customerId!, status: { in: ["BOOKED", "CONFIRMED"] }, startsAt: { gt: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 5,
        include: { service: { select: { name: true } }, staff: { select: { displayName: true } } },
      });
      const f = new Intl.DateTimeFormat("tr-TR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
      return rows.map((r) => ({ hizmet: r.service.name, zaman: f.format(r.startsAt), personel: r.staff.displayName }));
    });
  }
}
