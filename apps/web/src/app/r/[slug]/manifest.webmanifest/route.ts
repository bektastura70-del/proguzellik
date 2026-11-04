import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_COLOR, salonApp } from "../salon-app";

/**
 * Salon başına uygulama bildirimi (manifest). id/start_url/scope salonun kendi yolundadır; böylece her salon ayrı
 * uygulama olarak kurulur ve bir salonun uygulaması başka salonun sayfalarını açmaz.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const app = await salonApp(slug);
  if (!app || app === "error" || !app.features.installable) return new NextResponse(null, { status: 404 });
  const base = `/r/${slug}/`;
  const manifest = {
    id: `${base}uygulama`,
    name: app.name,
    short_name: app.shortName,
    description: app.description ?? `${app.name} online randevu`,
    start_url: `${base}uygulama`,
    scope: base,
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: app.primaryColor ?? DEFAULT_COLOR,
    lang: "tr",
    dir: "ltr",
    categories: ["lifestyle", "beauty"],
    icons: [
      { src: `${base}simge/192`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}simge/512`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}simge/maskable`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new NextResponse(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
