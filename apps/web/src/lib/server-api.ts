import type { NextRequest } from "next/server";

export const API_URL = process.env.API_URL ?? "http://localhost:4000";
export const TOKEN_COOKIE = "pg_token";
export const TENANT_COOKIE = "pg_tenant";

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
  path: "/",
  maxAge: 60 * 60 * 8,
};

/**
 * İstemci IP'si yalnızca güvenilir bir ters vekil arkasında (TRUST_PROXY=1) X-Forwarded-For'dan alınır;
 * aksi hâlde istemcinin gönderdiği başlık yok sayılır (hız sınırını atlatmayı önler).
 */
export function clientIpHeaders(req: NextRequest): Record<string, string> {
  if (process.env.TRUST_PROXY !== "1") return {};
  // Son değer, önümüzdeki güvenilir vekilin (Caddy) gördüğü bağlantı adresidir. İlk değer istemci
  // tarafından uydurulabilir (vekil gelen başlığa ekleme yapıyorsa), bu yüzden kullanılmaz.
  const ip = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return ip ? { "X-Forwarded-For": ip } : {};
}

/** Durum değiştiren isteklerde aynı köken kontrolü (CSRF'e karşı ek katman). */
export function sameOrigin(req: NextRequest) {
  if (["GET", "HEAD"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}
