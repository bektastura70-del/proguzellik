import { NextRequest, NextResponse } from "next/server";
import { API_URL } from "@/lib/server-api";
import { SLUG_RE } from "../../salon-app";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IMAGE = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Salonun logo/simgesi (aynı kökenden). Yalnızca PNG/JPEG/WebP; içerik türü koklanmaz, sayfa olarak çalıştırılamaz. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await ctx.params;
  if (!SLUG_RE.test(slug) || !UUID.test(id)) return new NextResponse(null, { status: 404 });
  const res = await fetch(`${API_URL}/public/salons/${slug}/assets/${id}`, { cache: "no-store" }).catch(() => null);
  const type = res?.headers.get("content-type") ?? "";
  if (!res?.ok || !IMAGE.has(type)) return new NextResponse(null, { status: res?.status === 404 ? 404 : 502 });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
