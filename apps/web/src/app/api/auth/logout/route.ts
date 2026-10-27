import { NextResponse } from "next/server";
import { TENANT_COOKIE, TOKEN_COOKIE } from "@/lib/server-api";

export async function POST() {
  const out = NextResponse.json({ ok: true });
  out.cookies.delete(TOKEN_COOKIE);
  out.cookies.delete(TENANT_COOKIE);
  return out;
}
