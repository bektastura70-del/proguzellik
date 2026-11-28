"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTr, timeTr, tl } from "@/lib/format";
import { syncNativeReminders } from "@/lib/native-app";
import { forgetBooking, loadSavedBookings } from "../saved-bookings";

type Details = {
  salon: { name: string; phone: string | null };
  service: string;
  staff: string;
  startsAt: string;
  price: string;
  status: "BOOKED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  cancellable: boolean;
  cancelHours: number;
};

const STATUS: Record<Details["status"], string> = {
  BOOKED: "Alındı",
  CONFIRMED: "Onaylandı",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal edildi",
  NO_SHOW: "Gelinmedi",
};

function Cancel({ slug }: { slug: string }) {
  const q = useSearchParams();
  const id = q.get("id") ?? "";
  const token = q.get("t") ?? "";
  const [d, setD] = useState<Details | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "done" | "busy">("idle");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) {
      setLoadErr("Bağlantı eksik. Randevu onay e-postanızdaki bağlantıyı kullanın.");
      return;
    }
    api<Details>(`/public/salons/${slug}/bookings/${id}?token=${encodeURIComponent(token)}`)
      .then(setD)
      .catch((e) => setLoadErr((e as Error).message));
  }, [slug, id, token]);

  async function cancel() {
    setState("busy");
    try {
      await api(`/public/salons/${slug}/bookings/${id}/cancel`, { method: "POST", body: { token } });
      forgetBooking(slug, id);
      // Mağaza uygulamasında bu randevunun telefon hatırlatmaları da kaldırılır.
      if (d) void syncNativeReminders(slug, d.salon.name, loadSavedBookings(slug).map((b) => ({ id: b.id, startsAt: b.startsAt, status: b.status ?? "BOOKED", service: b.service })));
      setState("done");
    } catch (e) {
      setErr((e as Error).message);
      setState("idle");
    }
  }

  if (loadErr) return <Card className="mt-8 p-6"><Alert>{loadErr}</Alert></Card>;
  if (!d) return <div className="mt-8 grid place-items-center"><Spinner /></div>;
  const cancelled = state === "done" || d.status === "CANCELLED";
  return (
    <Card className="mt-8 p-6">
      <h1 className="font-display text-xl font-semibold">{d.salon.name}</h1>
      <div className="mt-4 space-y-1 rounded-xl bg-sand-50 p-4 text-sm" data-testid="randevu-ozeti">
        <div><b>Hizmet:</b> {d.service}</div>
        <div><b>Uzman:</b> {d.staff}</div>
        <div><b>Tarih:</b> {dateTr(d.startsAt, { weekday: "long", day: "numeric", month: "long" })} {timeTr(d.startsAt)}</div>
        <div><b>Ücret:</b> {tl(d.price)}</div>
        <div><b>Durum:</b> {cancelled ? "İptal edildi" : STATUS[d.status]}</div>
      </div>
      {cancelled ? (
        <p className="mt-4 text-center">Randevunuz iptal edildi.</p>
      ) : d.cancellable ? (
        <div className="mt-4 text-center">
          <p className="mb-4">Randevunuzu iptal etmek istiyor musunuz?</p>
          {err && <div className="mb-4"><Alert>{err}</Alert></div>}
          <Button variant="danger" onClick={cancel} disabled={state === "busy"}>Evet, iptal et</Button>
        </div>
      ) : ["BOOKED", "CONFIRMED"].includes(d.status) ? (
        <p className="mt-4 text-sm text-neutral-600">
          Randevuya {d.cancelHours} saatten az kaldığı için online iptal edilemez. Lütfen işletmeyi arayın{d.salon.phone ? `: ${d.salon.phone}` : "."}
        </p>
      ) : null}
      <p className="mt-6 text-center text-sm"><Link href={`/r/${slug}`} className="text-brand-700 underline">Salon sayfasına dön</Link></p>
    </Card>
  );
}

export default function CancelPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <div className="mx-auto max-w-md px-5 py-16">
      <Logo />
      <Suspense><Cancel slug={slug} /></Suspense>
    </div>
  );
}
