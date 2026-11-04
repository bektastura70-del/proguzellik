import { NextRequest, NextResponse } from "next/server";
import { API_URL, clientIpHeaders, sameOrigin } from "@/lib/server-api";

/**
 * Müşteri portalı vekili (salon başına). Müşteri oturumu httpOnly çerezde tutulur; çerezin yolu /r/{slug}
 * olduğu için yalnızca o salonun sayfalarına gönderilir (başka salona veya işletme paneline gitmez).
 * İşletme paneli oturumu (pg_token) bu vekilden API'ye ASLA aktarılmaz.
 */
const CUSTOMER_COOKIE = "pg_cs";
const ALLOWED = new Set(["app", "availability", "portal"]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ slug: string; path: string[] }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Geçersiz istek kaynağı" }, { status: 403 });
  const { slug, path } = await ctx.params;
  if (!/^[a-z0-9-]{1,60}$/.test(slug) || !ALLOWED.has(path[0]) || path.some((p) => p === ".." || p.includes("/"))) {
    return NextResponse.json({ message: "Bulunamadı" }, { status: 404 });
  }
  const headers: Record<string, string> = { "Content-Type": "application/json", ...clientIpHeaders(req) };
  const session = req.cookies.get(CUSTOMER_COOKIE)?.value;
  if (session) headers["X-Customer-Session"] = session;
  const idem = req.headers.get("idempotency-key");
  if (idem) headers["Idempotency-Key"] = idem;
  const ua = req.headers.get("user-agent");
  if (ua) headers["User-Agent"] = ua.slice(0, 300);

  const res = await fetch(`${API_URL}/public/salons/${slug}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
    cache: "no-store",
  });
  let text = await res.text();
  const cookiePath = `/r/${slug}`;
  const secure = process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1";
  let setSession: { token: string; expiresAt: string } | null = null;
  const isVerify = path[0] === "portal" && path[1] === "verify" && req.method === "POST";
  if (isVerify && res.ok) {
    // Belirteç tarayıcı JS'ine verilmez; yalnızca httpOnly çereze yazılır.
    const body = JSON.parse(text) as { token: string; expiresAt: string };
    setSession = body;
    text = JSON.stringify({ ok: true, expiresAt: body.expiresAt });
  }
  const out = new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" },
  });
  if (setSession) {
    out.cookies.set(CUSTOMER_COOKIE, setSession.token, {
      httpOnly: true, sameSite: "lax", secure, path: cookiePath, expires: new Date(setSession.expiresAt),
    });
  }
  const loggedOut = path[0] === "portal" && path[1] === "logout";
  if (loggedOut || (res.status === 401 && session && path[0] === "portal")) {
    out.cookies.set(CUSTOMER_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: cookiePath, maxAge: 0 });
  }
  return out;
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
