import { NextRequest, NextResponse } from "next/server";

/** Mağaza uygulaması (iOS/Android) tarayıcı kimliğine bu eki ekler. */
const NATIVE_UA = /ProGuzellikApp\/\d/;

/**
 * Uygulama içinde açılmayan sayfalar: satın alma, fiyatlar, deneme kaydı ve tanıtım sitesi.
 * Mağaza kuralları (Apple 3.1.1 / 3.1.3(b), Google Play ödemeler politikası) uygulama içinde dijital abonelik satışını
 * mağazanın ödeme sistemi dışında yasaklar; abonelik işlemleri yalnızca web sitesinde yapılır.
 */
const NATIVE_BLOCKED = [/^\/$/, /^\/satin-al(\/|$)/, /^\/fiyatlar$/, /^\/ucretsiz-deneme$/, /^\/kayit$/, /^\/panel\/abonelik(\/|$)/, /^\/api\/odeme(\/|$)/];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (NATIVE_UA.test(req.headers.get("user-agent") ?? "") && NATIVE_BLOCKED.some((re) => re.test(path))) {
    if (path.startsWith("/api/")) return NextResponse.json({ message: "Bu işlem uygulamada yapılamaz" }, { status: 403 });
    return NextResponse.redirect(new URL(path === "/" ? "/giris" : "/uygulamada-yok", req.url));
  }
  // Panel sayfaları oturum çerezi olmadan açılmaz (asıl yetki kontrolü API'dedir).
  if (/^\/(panel|platform)(\/|$)|^\/(parola-degistir|guvenlik)$/.test(path) && !req.cookies.get("pg_token")) {
    const url = new URL("/giris", req.url);
    url.searchParams.set("donus", path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/panel/:path*", "/platform/:path*", "/parola-degistir", "/guvenlik",
    "/", "/satin-al/:path*", "/fiyatlar", "/ucretsiz-deneme", "/kayit", "/api/odeme/:path*",
  ],
};
