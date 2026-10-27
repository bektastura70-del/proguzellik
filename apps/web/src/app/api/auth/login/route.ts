import { NextRequest, NextResponse } from "next/server";
import { API_URL, cookieOptions, TENANT_COOKIE, TOKEN_COOKIE } from "@/lib/server-api";

/** Girişte token yalnızca httpOnly çerezde tutulur; tarayıcı JavaScript'i erişemez. */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/auth/${req.nextUrl.pathname.endsWith("register") ? "register" : "login"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": req.headers.get("x-forwarded-for") ?? "" },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  const out = NextResponse.json({ user: data.user });
  out.cookies.set(TOKEN_COOKIE, data.accessToken, cookieOptions);
  const first = data.user?.memberships?.[0]?.tenant?.id;
  if (first) out.cookies.set(TENANT_COOKIE, first, { ...cookieOptions, httpOnly: false });
  return out;
}
