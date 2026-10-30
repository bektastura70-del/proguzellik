import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL, TOKEN_COOKIE } from "@/lib/server-api";

export const metadata = { title: "SaaS yönetimi", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Yalnızca SaaS sahibi (platform yöneticisi) içindir. Yetki asıl olarak API'de denetlenir;
 * burada yetkisiz kullanıcılar sayfa hiç gösterilmeden yönlendirilir.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) redirect("/giris?donus=/platform");
  let me: { isPlatformAdmin?: boolean } | null = null;
  let status = 0;
  try {
    const res = await fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    status = res.status;
    if (res.ok) me = await res.json();
  } catch {
    status = 0;
  }
  if (status === 401) redirect("/giris?sure=doldu&donus=/platform");
  if (me && !me.isPlatformAdmin) redirect("/panel");
  return children;
}
