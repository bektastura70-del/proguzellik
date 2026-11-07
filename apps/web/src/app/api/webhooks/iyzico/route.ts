import { NextRequest, NextResponse } from "next/server";
import { API_URL, clientIpHeaders } from "@/lib/server-api";

/**
 * iyzico abonelik bildirimlerini API'ye aktarır. İmza (X-IYZ-SIGNATURE-V3) API'de doğrulanır
 * ve abonelik durumu her zaman iyzico API'sinden okunur.
 */
const MAX_BYTES = 64_000;

export async function POST(req: NextRequest) {
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return NextResponse.json({ message: "Çok büyük" }, { status: 413 });
  const headers: Record<string, string> = { "Content-Type": "application/json", ...clientIpHeaders(req) };
  const sig = req.headers.get("x-iyz-signature-v3");
  if (sig) headers["X-IYZ-SIGNATURE-V3"] = sig;
  const res = await fetch(`${API_URL}/billing/iyzico/webhook`, { method: "POST", headers, body, cache: "no-store" });
  return new NextResponse(await res.text(), { status: res.status, headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" } });
}
