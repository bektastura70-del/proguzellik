import { API_URL } from "@/lib/server-api";
import type { AppInfo } from "./portal-api";

export const SLUG_RE = /^[a-z0-9-]{1,60}$/;

/** Salonun herkese açık uygulama bilgisi. null: bilinmeyen/kapalı salon (404); "error": API'ye ulaşılamadı. */
export async function salonApp(slug: string): Promise<AppInfo | null | "error"> {
  if (!SLUG_RE.test(slug)) return null;
  try {
    const r = await fetch(`${API_URL}/public/salons/${slug}/app`, { cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) return "error";
    return (await r.json()) as AppInfo;
  } catch {
    return "error";
  }
}

export const DEFAULT_COLOR = "#4a2535";

/** Kullanıcıdan gelen metni HTML/SVG içine güvenle yazmak için */
export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
