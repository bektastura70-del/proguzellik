"use client";

import { CalendarClock, Check, Mail, MessageCircle, Phone, X } from "lucide-react";
import { useState } from "react";
import { AppointmentDetail } from "@/components/calendar/dialogs";
import { useSession } from "@/components/panel/session";
import type { Appointment, Staff } from "@/components/panel/types";
import { Badge, Button, Card, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTr, timeTr } from "@/lib/format";

const SHOW = 5;

export type PendingAppointment = Appointment & { createdAt: string; customerEmail: boolean };

/** Türkiye numarasını wa.me biçimine çevirir (0555… → 90555…); çevrilemezse null. */
export function waNumber(phone: string | null) {
  const d = (phone ?? "").replace(/\D/g, "");
  if (/^0\d{10}$/.test(d)) return `9${d}`;
  if (/^90\d{10}$/.test(d)) return d;
  if (/^5\d{9}$/.test(d)) return `90${d}`;
  return null;
}

/**
 * Salonun kendi telefonundaki WhatsApp'ı hazır metinle açan bağlantı (wa.me). Sistem mesaj göndermez,
 * Meta/WhatsApp Business bağlantısı gerekmez; salon mesajı kendi uygulamasından kendisi yollar.
 */
export function waLink(phone: string | null, text: string) {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

/** Müşteriye salonun kendi WhatsApp'ından gönderilecek hazır onay metni (salon düzenleyip gönderir). */
export function confirmMessage(salon: string, a: Pick<Appointment, "customer" | "service" | "startsAt">) {
  const when = `${dateTr(a.startsAt, { day: "numeric", month: "long", weekday: "long" })} ${timeTr(a.startsAt)}`;
  return `Merhaba ${a.customer.firstName}, ${salon} için ${when} tarihli ${a.service.name} randevunuz onaylandı. Görüşmek üzere.`;
}

/**
 * Onay bekleyen randevular (müşterinin online/uygulamadan aldığı, gelecekteki "Bekliyor" kayıtlar).
 * Her işletmede çalışır; WhatsApp veya salon uygulaması (pilot) gerekmez. Randevu alındığı anda geçerlidir:
 * salon isterse onaylar, reddeder ya da başka saat verir. Müşteri formda e-posta yazdıysa karar e-postayla gider;
 * yazmadıysa salon arayabilir ya da kendi WhatsApp'ından hazır metinle yazabilir.
 */
export function PendingApprovals({ className, onChange, version = 0 }: { className?: string; onChange?: () => void; /** Değişince liste yenilenir (ör. takvimde durum değişti). */ version?: number }) {
  const { current, can } = useSession();
  const toast = useToast();
  const list = useApi<PendingAppointment[]>("/appointments/pending", [version]);
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<{ appt: PendingAppointment; mode: "edit" | "cancel" } | null>(null);
  const staff = useApi<Staff[]>(open ? "/staff" : null, [!!open]);
  const desk = can("OWNER", "MANAGER", "RECEPTION");
  const salon = current?.tenant.name ?? "Salonumuz";

  if (!list.data?.length) return null;

  async function confirm(a: PendingAppointment) {
    setBusy(a.id);
    try {
      await api(`/appointments/${a.id}/status`, { method: "POST", body: { status: "CONFIRMED" } });
      toast(a.customerEmail ? "Onaylandı; müşteriye e-posta gönderiliyor" : "Onaylandı");
      await list.reload();
      onChange?.();
    } catch (e) {
      toast((e as Error).message, "red");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className={className} data-testid="onay-bekleyenler">
      <div className="border-b border-sand-100 px-4 py-3">
        <h2 className="font-semibold">Onay bekleyen randevular ({list.data.length})</h2>
        <p className="text-xs text-neutral-500">Müşterinin aldığı randevu geçerlidir ve takvimde yerini tutar. İsterseniz onaylayın, reddedin ya da başka saat verin.</p>
      </div>
      <ul className="divide-y divide-sand-100">
        {(all ? list.data : list.data.slice(0, SHOW)).map((a) => {
          const wa = desk && a.customer.phone ? waLink(a.customer.phone, confirmMessage(salon, a)) : null;
          return (
            <li key={a.id} className="px-4 py-3" data-testid="onay-satiri">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {a.customer.firstName} {a.customer.lastName}
                    {a.source === "ONLINE" && <Badge tone="brand">Online</Badge>}
                  </div>
                  <div className="text-neutral-600">
                    {dateTr(a.startsAt, { day: "numeric", month: "short", weekday: "short" })} {timeTr(a.startsAt)} · {a.service.name} · {a.staff.displayName}
                  </div>
                  {a.notes && <p className="mt-1 whitespace-pre-line text-xs text-neutral-500">{a.notes}</p>}
                  <p className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
                    <Mail className="size-3.5" />
                    {a.customerEmail ? "Kararınız müşteriye e-postayla bildirilir." : "Müşteri e-posta vermedi: kararınızı arayarak ya da WhatsApp'tan yazarak bildirin."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void confirm(a)} disabled={busy === a.id}><Check className="size-4" />Onayla</Button>
                  {desk && <Button size="sm" variant="secondary" onClick={() => setOpen({ appt: a, mode: "edit" })}><CalendarClock className="size-4" />Başka saat</Button>}
                  <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setOpen({ appt: a, mode: "cancel" })}><X className="size-4" />Reddet</Button>
                </div>
              </div>
              {a.customer.phone && (
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <a href={`tel:${a.customer.phone}`} className="inline-flex items-center gap-1 text-brand-700"><Phone className="size-3.5" />Ara</a>
                  {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700"><MessageCircle className="size-3.5" />Onayı kendi WhatsApp&apos;ınızdan yazın</a>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {list.data.length > SHOW && (
        <button type="button" onClick={() => setAll(!all)} className="w-full border-t border-sand-100 px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-sand-50">
          {all ? "Daha az göster" : `Tümünü göster (${list.data.length})`}
        </button>
      )}
      {open && (open.mode === "cancel" || staff.data) && (
        <AppointmentDetail
          appt={open.appt}
          staff={staff.data ?? []}
          initialMode={open.mode}
          onClose={() => setOpen(null)}
          onChange={() => { setOpen(null); void list.reload(); onChange?.(); }}
        />
      )}
    </Card>
  );
}
