import { NextResponse } from "next/server";

/**
 * iOS evrensel bağlantılar (https://proguzellik.com/r/... uygulamada açılsın).
 * APPLE_TEAM_ID: Apple Developer hesabındaki 10 karakterlik Team ID. Tanımlı değilse 404.
 * Uygulamada Xcode > Signing & Capabilities > Associated Domains: applinks:proguzellik.com eklenmelidir.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const team = (process.env.APPLE_TEAM_ID ?? "").trim();
  if (!/^[A-Z0-9]{10}$/.test(team)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(
    { applinks: { details: [{ appIDs: [`${team}.com.proguzellik.app`], components: [{ "/": "/r/*", comment: "Salon sayfaları" }] }] } },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
