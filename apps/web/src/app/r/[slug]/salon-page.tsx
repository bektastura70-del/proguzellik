import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { BookingClient } from "./booking-client";
import { PortalClient } from "./portal-client";
import { SalonSwRegister } from "./portal-extras";
import { DEFAULT_COLOR, salonApp } from "./salon-app";

/** /r/{slug} ve /r/{slug}/uygulama için ortak meta veri, görünüm ve içerik. */
export async function salonMetadata(slug: string): Promise<Metadata> {
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
          icons: { icon: [{ url: `/r/${slug}/simge/192`, type: "image/png", sizes: "192x192" }], apple: `/r/${slug}/simge/180` },
        }
      : {}),
  };
}

export async function salonViewport(slug: string): Promise<Viewport> {
  const app = await salonApp(slug);
  const color = app && app !== "error" && app.features.installable ? (app.primaryColor ?? DEFAULT_COLOR) : DEFAULT_COLOR;
  return { themeColor: color, width: "device-width", initialScale: 1, viewportFit: "cover" };
}

export async function SalonPage({ slug, params }: { slug: string; params: Promise<{ slug: string }> }) {
  const app = await salonApp(slug);
  if (!app) notFound();
  const installable = app !== "error" && app.features.installable;
  return (
    <>
      {installable && <SalonSwRegister slug={slug} />}
      {app !== "error" && app.features.portal ? <PortalClient slug={slug} app={app} /> : <BookingClient params={params} />}
    </>
  );
}
