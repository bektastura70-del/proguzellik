import { NextRequest, NextResponse } from "next/server";
import { API_URL, clientIpHeaders } from "@/lib/server-api";

/**
 * Meta (WhatsApp/Instagram) webhook'larını API'ye olduğu gibi aktarır (ortak adres ve işletmeye özel adres).
 * Gövde bayt bayt korunur: imza (X-Hub-Signature-256) API'de bu ham gövde üzerinden doğrulanır.
 * Oturum çerezi aktarılmaz; uç nokta herkese açıktır ve tüm güvenlik API'deki imza kontrolündedir.
 */
const MAX_BYTES = 1_000_000;

export async function relayMetaWebhook(req: NextRequest, path: string) {
  const url = `${API_URL}${path}${req.nextUrl.search}`;
  const headers: Record<string, string> = { ...clientIpHeaders(req) };
  let body: ArrayBuffer | undefined;
  if (req.method === "POST") {
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return NextResponse.json({ message: "Çok büyük" }, { status: 413 });
    headers["Content-Type"] = req.headers.get("content-type") ?? "application/json";
    const sig = req.headers.get("x-hub-signature-256");
    if (sig) headers["X-Hub-Signature-256"] = sig;
  }
  const res = await fetch(url, { method: req.method, headers, body, cache: "no-store" });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "text/plain" },
  });
}
