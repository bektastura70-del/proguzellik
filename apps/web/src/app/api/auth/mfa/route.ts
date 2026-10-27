import { NextRequest, NextResponse } from "next/server";
import { API_URL, clientIpHeaders, cookieOptions, sameOrigin, TENANT_COOKIE, TOKEN_COOKIE } from "@/lib/server-api";

/** 2FA ikinci adımı: doğrulanınca oturum token'ı httpOnly çereze yazılır. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Geçersiz istek kaynağı" }, { status: 403 });
  const res = await fetch(`${API_URL}/auth/mfa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": req.headers.get("user-agent") ?? "", ...clientIpHeaders(req) },
    body: await req.text(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  const out = NextResponse.json({ user: data.user });
  out.cookies.set(TOKEN_COOKIE, data.accessToken, cookieOptions);
  const first = data.user?.memberships?.[0]?.tenant?.id;
  if (first) out.cookies.set(TENANT_COOKIE, first, { ...cookieOptions, httpOnly: false });
  return out;
}
