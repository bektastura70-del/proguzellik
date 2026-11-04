import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/server-api";
import { DEFAULT_COLOR, salonApp } from "../../salon-app";

const SIZES: Record<string, { px: number; maskable: boolean }> = {
  "180": { px: 180, maskable: false },
  "192": { px: 192, maskable: false },
  "512": { px: 512, maskable: false },
  maskable: { px: 512, maskable: true },
};

/** Salon simgesinin istenen boyutu (PNG). Yüklenmiş simge yoksa salon renginde baş harfli simge üretilir. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string; size: string }> }) {
  const { slug, size } = await ctx.params;
  const spec = SIZES[size];
  const app = spec ? await salonApp(slug) : null;
  if (!spec || !app || app === "error" || !app.features.installable) return new NextResponse(null, { status: 404 });

  let src: string | null = null;
  const id = app.iconUrl?.split("/").pop();
  if (id) {
    const r = await fetch(`${API_URL}/public/salons/${slug}/assets/${id}`, { cache: "no-store" }).catch(() => null);
    const type = r?.headers.get("content-type");
    if (r?.ok && (type === "image/png" || type === "image/jpeg")) src = `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  }
  const bg = app.primaryColor ?? DEFAULT_COLOR;
  // Maskelenebilir simgede içerik ortadaki güvenli alanda (%80) kalır.
  const inner = spec.maskable ? Math.round(spec.px * 0.7) : spec.px;
  const initial = Array.from(app.shortName.trim() || app.name.trim())[0]?.toLocaleUpperCase("tr-TR") ?? "S";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: src && !spec.maskable ? "#ffffff" : bg }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} width={inner} height={inner} alt="" style={{ objectFit: "cover" }} />
        ) : (
          <div style={{ display: "flex", fontSize: Math.round(inner * 0.55), fontWeight: 700, color: "#ffffff" }}>{initial}</div>
        )}
      </div>
    ),
    { width: spec.px, height: spec.px, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
