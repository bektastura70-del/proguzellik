import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { API_URL } from "@/lib/server-api";
import { BookingClient } from "./booking-client";

export const dynamic = "force-dynamic";

/** Online randevuya açık mı? Bilinmeyen veya kapalı işletme gerçek 404 döner (arama motorlarında boş sayfa dizinlenmez). */
async function salonOpen(slug: string) {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return false;
  try {
    const r = await fetch(`${API_URL}/public/salons/${slug}`, { cache: "no-store" });
    if (r.status === 404) return false;
  } catch {
    /* API'ye ulaşılamazsa istemci sayfası kendi hata mesajını gösterir */
  }
  return true;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return (await salonOpen(slug)) ? {} : { robots: { index: false, follow: false } };
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await salonOpen(slug))) notFound();
  return <BookingClient params={params} />;
}
