"use client";

import { Alert, Card, CardBody, CardHeader } from "@/components/ui";
import { useApi } from "@/lib/api";

type AiQuota =
  | { available: false }
  | { available: true; tracking: boolean; enforced: boolean; percent: number; state: "ok" | "low" | "empty"; renewsInDays: number; renewsAt: string; hasExtra: boolean };

/**
 * Yapay zekâ kullanım hakkı barı. Salon para, birim ya da konuşma sayısı görmez; yalnız yaklaşık yüzde.
 * Konuşmalar oldukça bar kısalır; her ay yenilenir.
 */
export function AiQuotaCard({ compact = false }: { compact?: boolean }) {
  const q = useApi<AiQuota>("/ai-quota");
  const d = q.data;
  if (!d || !d.available || !d.tracking) return null;
  const color = d.state === "empty" ? "bg-red-500" : d.state === "low" ? "bg-amber-500" : "bg-brand-500";
  const renew = d.renewsInDays <= 1 ? "Aylık hakkınız yaklaşık 1 gün içinde yenilenecek." : `Aylık hakkınız yaklaşık ${d.renewsInDays} gün sonra yenilenecek.`;
  return (
    <Card className={compact ? "" : "mt-6"}>
      <CardHeader title="Yapay zekâ kullanım hakkı" description="Yapay zekâ müşterilerinize yanıt verdikçe bar kısalır." />
      <CardBody className="space-y-3 text-sm">
        <div
          className="h-3 rounded-full bg-sand-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={d.percent}
          aria-label="Kalan yapay zekâ kullanım hakkı (yaklaşık)"
        >
          <div className={`h-3 rounded-full transition-all ${color}`} style={{ width: `${d.percent}%` }} />
        </div>
        {d.state === "empty" ? (
          <Alert>Kullanım hakkınız doldu. Gelen mesajlar ekibinize yönlendiriliyor.</Alert>
        ) : (
          <p>
            Yaklaşık <b>%{d.percent}</b> kullanım hakkınız kaldı.
            {d.state === "low" && <span className="ml-1 text-amber-700">Kullanım hakkınız azalıyor.</span>}
          </p>
        )}
        <p className="text-xs text-neutral-500">{renew}{d.hasExtra ? " Ek paketten kalan hakkınız ayrıca korunur." : ""}</p>
        {!d.enforced && <p className="text-xs text-neutral-500">Kullanım ölçümü deneme aşamasında; şu an yanıtlar kesilmez.</p>}
      </CardBody>
    </Card>
  );
}
