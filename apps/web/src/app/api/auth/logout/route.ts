import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, TENANT_COOKIE, TOKEN_COOKIE } from "@/lib/server-api";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Geçersiz istek kaynağı" }, { status: 403 });
  const out = NextResponse.json({ ok: true });
  out.cookies.delete(TOKEN_COOKIE);
  out.cookies.delete(TENANT_COOKIE);
  return out;
}
