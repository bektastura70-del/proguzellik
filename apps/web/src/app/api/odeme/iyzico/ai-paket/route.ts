import { NextRequest } from "next/server";
import { API_URL, clientIpHeaders } from "@/lib/server-api";

/**
 * Yapay zekâ ek paketi ödeme formundan dönüş: iyzico tarayıcıyı bu adrese token ile POST eder.
 * Token API'ye iletilir; API sonucu iyzico'dan sorgulayıp doğrular. Kullanıcı ek paket sayfasına yönlendirilir.
 * (Çapraz site POST olduğu için köken kontrolü yapılmaz; güvenlik API'deki iyzico doğrulamasındadır.)
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
  // Sonuç yalnız sabit kodla taşınır; adres çubuğundan panelde serbest metin gösterilmez.
  let result: "basarili" | "basarisiz" | "bekliyor" = "basarisiz";
  if (/^[\w-]{10,200}$/.test(token)) {
    try {
      const res = await fetch(`${API_URL}/billing/iyzico/ai-callback`, {
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
  const q = new URLSearchParams({ odeme: result });
  // Göreli adres: ters vekil arkasında doğru alan adına döner.
  return new Response(null, { status: 303, headers: { Location: `/panel/abonelik/ai-paket?${q}`, "Cache-Control": "no-store" } });
}

export { back as GET, back as POST };
