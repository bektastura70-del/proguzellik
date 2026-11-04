import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_COLOR, escapeHtml, salonApp } from "../salon-app";

/** Çevrimdışı ekranı: yalnızca salon adı ve rengi (kişisel veri yok). Service worker kurulumda önbelleğe alır. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const app = await salonApp(slug);
  if (!app || app === "error" || !app.features.installable) return new NextResponse(null, { status: 404 });
  const name = escapeHtml(app.name);
  const color = /^#[0-9a-fA-F]{6}$/.test(app.primaryColor ?? "") ? app.primaryColor! : DEFAULT_COLOR;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="${color}"><title>${name} · Çevrimdışı</title>
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#222;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px;box-sizing:border-box}
.b{width:64px;height:64px;border-radius:16px;background:${color};margin:0 auto 16px}h1{font-size:20px;margin:0 0 8px}p{color:#555;margin:0 0 20px;line-height:1.5}
a{display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600}</style></head>
<body><main><div class="b" aria-hidden="true"></div><h1>${name}</h1><p>İnternet bağlantısı yok. Randevu bilgileriniz güvenlik nedeniyle cihazda saklanmaz; bağlantı gelince tekrar deneyin.</p>
<a href="/r/${slug}/uygulama">Tekrar dene</a></main></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
}
