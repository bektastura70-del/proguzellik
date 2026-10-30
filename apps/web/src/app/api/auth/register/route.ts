import { NextRequest, NextResponse } from "next/server";
import { API_URL, clientIpHeaders, cookieOptions, sameOrigin, TENANT_COOKIE, TOKEN_COOKIE } from "@/lib/server-api";

/** Girişte token yalnızca httpOnly çerezde tutulur; tarayıcı JavaScript'i erişemez. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Geçersiz istek kaynağı" }, { status: 403 });
  const body = await req.text();
  const path = req.nextUrl.pathname.endsWith("/register/confirm") ? "register/confirm" : req.nextUrl.pathname.endsWith("/register") ? "register" : "login";
  const res = await fetch(`${API_URL}/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": req.headers.get("user-agent") ?? "", ...clientIpHeaders(req) },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  // 2FA açık hesaplarda ilk adımda oturum açılmaz; ara belirteç istemciye döner.
  if (data.mfaRequired) return NextResponse.json({ mfaRequired: true, mfaToken: data.mfaToken });
  // Deneme başvurusu (202): oturum yok, yalnızca "e-postanızı kontrol edin" bilgisi döner.
  if (!data.accessToken) return NextResponse.json(data, { status: res.status });
  const out = NextResponse.json({ user: data.user });
  out.cookies.set(TOKEN_COOKIE, data.accessToken, cookieOptions);
  const first = data.user?.memberships?.[0]?.tenant?.id;
  if (first) out.cookies.set(TENANT_COOKIE, first, { ...cookieOptions, httpOnly: false });
  return out;
}
