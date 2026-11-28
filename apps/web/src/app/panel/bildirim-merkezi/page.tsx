"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/panel/session";
import { Alert, Button, Card, Empty, PageHeader, Spinner, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dateTimeTr, isoDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StaffPushCard } from "./push-card";

type N = { id: string; type: string; title: string; body: string; appointmentId: string | null; readAt: string | null; createdAt: string };
type AlertChannels = { email: { enabled: boolean; to: string | null }; push: { available: boolean }; whatsapp: { inPlan: boolean; connected: boolean } };
type Prefs = { newAppointments: boolean; cancellations: boolean; changes: boolean; assignments: boolean };

/** Uygulama içi bildirim merkezi: yalnız oturumdaki kullanıcıya ait bildirimler. */
export default function NotificationCenterPage() {
  const { can, pwa } = useSession();
  const toast = useToast();
  const router = useRouter();
  const list = useApi<{ items: N[]; unread: number }>("/pwa/notifications");
  const prefs = useApi<Prefs>("/pwa/preferences");
  const channels = useApi<AlertChannels>("/pwa/alert-channels");

  async function readAll() {
    await api("/pwa/notifications/read-all", { method: "POST" });
    await list.reload();
  }
  /** Bildirime tıklanınca okundu yapılır; randevuyla ilgiliyse takvimde o randevu açılır (onayla / reddet / başka saat). */
  async function open(n: N) {
    if (!n.readAt) await api(`/pwa/notifications/${n.id}/read`, { method: "POST" }).catch(() => undefined);
    if (n.appointmentId) {
      try {
        const a = await api<{ startsAt: string }>(`/appointments/${n.appointmentId}`);
        router.push(`/panel/takvim?gorunum=gun&tarih=${isoDay(new Date(a.startsAt))}&randevu=${n.appointmentId}`);
        return;
      } catch {
        toast("Randevu bulunamadı (silinmiş ya da size kapalı olabilir)", "amber");
      }
    }
    await list.reload();
  }
  async function toggle(key: keyof Prefs, value: boolean) {
    try {
      prefs.setData(await api<Prefs>("/pwa/preferences", { method: "PATCH", body: { [key]: value } }));
    } catch (e) {
      toast((e as Error).message, "red");
    }
  }

  const PREFS: { key: keyof Prefs; label: string; desk?: boolean }[] = [
    { key: "newAppointments", label: "Yeni randevular (tüm işletme)", desk: true },
    { key: "assignments", label: "Bana atanan randevular" },
    { key: "cancellations", label: "Müşteri iptalleri" },
    { key: "changes", label: "Randevu saat değişiklikleri" },
  ];
  return (
    <>
      <PageHeader
        title="Bildirim merkezi"
        description="Müşterilerin online aldığı ve iptal ettiği randevular burada görünür; ayrıca e-postanıza gelir."
        action={list.data?.unread ? <Button variant="secondary" size="sm" onClick={() => void readAll()}>Tümünü okundu yap</Button> : undefined}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {list.error && <Alert>{list.error.message}</Alert>}
          {list.loading && !list.data ? <Spinner /> : !list.data?.items.length ? (
            <Empty title="Bildirim yok">Yeni randevu, iptal ve değişiklikler burada listelenir.</Empty>
          ) : (
            <Card>
              <ul className="divide-y divide-sand-100">
                {list.data.items.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => void open(n)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left", !n.readAt && "bg-brand-50/60")}>
                      <Bell className={cn("mt-0.5 size-4 shrink-0", n.readAt ? "text-neutral-400" : "text-brand-700")} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                        <span className="block text-sm text-neutral-600">{n.body}</span>
                        <span className="block text-xs text-neutral-400">{dateTimeTr(n.createdAt)}</span>
                      </span>
                      {!n.readAt && <span className="sr-only">Okunmadı</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <p className="mt-4 text-sm">
            {pwa?.businessPwaEnabled
              ? <Link href="/panel/bugun" className="text-brand-700 underline">Bugünün planına git</Link>
              : <Link href="/panel/takvim" className="text-brand-700 underline">Takvime git</Link>}
          </p>
        </div>
        <div className="space-y-4">
          {channels.data && (
            <Card className="p-4" data-testid="bildirim-kanallari">
              <h2 className="font-semibold">Bildirimler nereye gelir?</h2>
              <ul className="mt-3 space-y-2 text-sm text-neutral-700">
                <li><b>Panel:</b> bu sayfa ve menüdeki kırmızı rozet.</li>
                <li>
                  <b>E-posta:</b>{" "}
                  {channels.data.email.enabled && channels.data.email.to ? <>{channels.data.email.to}</> : <span className="text-amber-700">şu an gönderilmiyor</span>}
                </li>
                <li>
                  <b>Telefon bildirimi:</b>{" "}
                  {channels.data.push.available ? "aşağıdaki karttan her telefonda ayrı ayrı açılır (iPhone'da ana ekrana eklenen uygulamadan)." : "şu an sistem genelinde kapalı."}
                </li>
                <li>
                  <b>Müşteriye bilgi:</b>{" "}
                  {channels.data.whatsapp.connected
                    ? "WhatsApp ve (formda yazdıysa) e-posta ile."
                    : "müşteri formda e-posta yazdıysa randevu, onay, ret ve saat değişikliği e-postayla gider. E-posta yoksa onay bekleyenler listesinden arayabilir ya da kendi WhatsApp'ınızdan yazabilirsiniz."}
                </li>
              </ul>
            </Card>
          )}
          <StaffPushCard />
          <Card className="p-4">
            <h2 className="font-semibold">Bildirim tercihleri</h2>
            <p className="mt-1 text-xs text-neutral-500">Panel, e-posta ve telefon bildirimleri için geçerlidir.</p>
            {!prefs.data ? <Spinner /> : (
              <ul className="mt-3 space-y-2">
                {PREFS.filter((p) => !p.desk || can("OWNER", "MANAGER", "RECEPTION")).map((p) => (
                  <li key={p.key}>
                    <label className="flex items-center justify-between gap-3 text-sm">
                      {p.label}
                      <input type="checkbox" className="size-4 accent-brand-600" checked={prefs.data![p.key]} onChange={(e) => void toggle(p.key, e.target.checked)} />
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
