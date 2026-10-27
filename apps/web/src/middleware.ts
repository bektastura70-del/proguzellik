import { NextRequest, NextResponse } from "next/server";

/** Panel sayfaları oturum çerezi olmadan açılmaz (asıl yetki kontrolü API'dedir). */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("pg_token")) {
    const url = new URL("/giris", req.url);
    url.searchParams.set("donus", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/panel/:path*", "/yonetim/:path*"] };
