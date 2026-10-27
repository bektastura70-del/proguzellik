import { NextRequest, NextResponse } from "next/server";
import { API_URL, sameOrigin, TENANT_COOKIE, TOKEN_COOKIE } from "@/lib/server-api";

/** Çıkışta sunucu tarafı oturum da kapatılır (token çalınmış olsa bile geçersiz olur). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Geçersiz istek kaynağı" }, { status: 403 });
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  if (token) {
    await fetch(`${API_URL}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }
  const out = NextResponse.json({ ok: true });
  out.cookies.delete(TOKEN_COOKIE);
  out.cookies.delete(TENANT_COOKIE);
  return out;
}
