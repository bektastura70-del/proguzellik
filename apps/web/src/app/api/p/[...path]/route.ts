import { NextRequest, NextResponse } from "next/server";
import { API_URL, clientIpHeaders, sameOrigin, TENANT_COOKIE, TOKEN_COOKIE } from "@/lib/server-api";

/**
 * API vekili: tarayıcı yalnızca bu uç noktayla konuşur (aynı köken, CORS yok).
 * Token httpOnly çerezden okunur ve Authorization başlığına eklenir.
 */
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ message: "Geçersiz istek kaynağı" }, { status: 403 });
  const { path } = await ctx.params;
  if (path.some((p) => p === ".." || p.includes("/"))) return NextResponse.json({ message: "Geçersiz yol" }, { status: 400 });
  const url = `${API_URL}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenant = req.headers.get("x-tenant-id") ?? req.cookies.get(TENANT_COOKIE)?.value;
  if (tenant) headers["X-Tenant-Id"] = tenant;
  Object.assign(headers, clientIpHeaders(req));
  const res = await fetch(url, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.text(),
    cache: "no-store",
  });
  const text = await res.text();
  const out: Record<string, string> = { "Content-Type": res.headers.get("content-type") ?? "application/json" };
  const disposition = res.headers.get("content-disposition");
  if (disposition) out["Content-Disposition"] = disposition;
  return new NextResponse(text, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
