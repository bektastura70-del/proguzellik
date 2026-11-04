import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { API_URL } from "@/lib/server-api";
import { BookingClient } from "./booking-client";
import type { AppInfo } from "./portal-api";
import { PortalClient } from "./portal-client";

export const dynamic = "force-dynamic";

/**
 * Online randevuya açık mı? Bilinmeyen veya kapalı işletme gerçek 404 döner (arama motorlarında boş sayfa dizinlenmez).
 * Müşteri portalı bayrağı kapalıysa mevcut (anonim) online randevu akışı aynen gösterilir.
 */
async function salonApp(slug: string): Promise<AppInfo | null | "error"> {
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  try {
    const r = await fetch(`${API_URL}/public/salons/${slug}/app`, { cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) return "error";
    return (await r.json()) as AppInfo;
  } catch {
    return "error"; // API'ye ulaşılamazsa istemci sayfası kendi hata mesajını gösterir
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const app = await salonApp(slug);
  if (!app) return { robots: { index: false, follow: false } };
  if (app === "error") return {};
  return {
    title: { absolute: `${app.name} · Online randevu` },
    description: app.description ?? `${app.name} için online randevu`,
    ...(app.features.installable
      ? {
          manifest: `/r/${slug}/manifest.webmanifest`,
          appleWebApp: { capable: true, title: app.shortName, statusBarStyle: "default" },
          icons: { apple: `/r/${slug}/simge/180` },
          other: { "theme-color": app.primaryColor ?? "#4a2535" },
        }
      : {}),
  };
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const app = await salonApp(slug);
  if (!app) notFound();
  if (app !== "error" && app.features.portal) return <PortalClient slug={slug} app={app} />;
  return <BookingClient params={params} />;
}
