import { NextResponse } from "next/server";

/**
 * Android uygulama bağlantıları (https://proguzellik.com/r/... uygulamada açılsın).
 * ANDROID_CERT_SHA256: Google Play Console > Uygulama imzalama > "Uygulama imzalama anahtarı sertifikası" SHA-256
 * (birden fazlaysa virgülle). Tanımlı değilse 404: doğrulama yapılmaz, bağlantılar tarayıcıda açılır.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const fingerprints = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  if (!fingerprints.length) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(
    [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "com.proguzellik.app", sha256_cert_fingerprints: fingerprints } }],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
