import { NextRequest } from "next/server";
import { API_URL, clientIpHeaders } from "@/lib/server-api";

/**
 * Siteden satın almada iyzico ödeme formundan dönüş. Token API'ye iletilir; API sonucu iyzico'dan doğrular
 * ve ödeme alındıysa işletme hesabını açar. Kullanıcı sonuç sayfasına (oturumsuz) yönlendirilir.
 */
async function back(req: NextRequest) {
  let token = "";
  try {
    if (req.method === "POST") {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) token = String(((await req.json()) as { token?: string }).token ?? "");
      else token = String((await req.formData()).get("token") ?? "");
    } else token = req.nextUrl.searchParams.get("token") ?? "";
  } catch {
    token = "";
  }
  // Sonuç yalnız sabit kodla taşınır; adres çubuğundan serbest metin gösterilmez.
  let result: "basarili" | "basarisiz" | "bekliyor" = "basarisiz";
  if (/^[\w-]{10,200}$/.test(token)) {
    try {
      const res = await fetch(`${API_URL}/billing/iyzico/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...clientIpHeaders(req) },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; pending?: boolean };
      result = res.ok && j.ok === true ? "basarili" : j.pending ? "bekliyor" : "basarisiz";
    } catch {
      result = "bekliyor";
    }
  }
  return new Response(null, { status: 303, headers: { Location: `/satin-al/sonuc?odeme=${result}`, "Cache-Control": "no-store" } });
}

export { back as GET, back as POST };
