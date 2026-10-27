import { NextRequest, NextResponse } from "next/server";
import { API_URL, clientIpHeaders, cookieOptions, sameOrigin, TENANT_COOKIE, TOKEN_COOKIE } from "@/lib/server-api";

/** Davet kabulü: yeni hesapta oturum belirteci yalnızca httpOnly çereze yazılır, tarayıcıya dönmez. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Geçersiz istek kaynağı" }, { status: 403 });
  const res = await fetch(`${API_URL}/auth/accept-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": req.headers.get("user-agent") ?? "", ...clientIpHeaders(req) },
    body: await req.text(),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  if (!data.accessToken) return NextResponse.json({ accepted: true, loginRequired: true });
  const out = NextResponse.json({ accepted: true, user: data.user });
  out.cookies.set(TOKEN_COOKIE, data.accessToken, cookieOptions);
  const first = data.user?.memberships?.[0]?.tenant?.id;
  if (first) out.cookies.set(TENANT_COOKIE, first, { ...cookieOptions, httpOnly: false });
  return out;
}
