import { redirect } from "next/navigation";

/** Eski adres: ücretsiz deneme sayfasına yönlendirir (paket seçimi korunur). */
export default async function LegacyRegister({ searchParams }: { searchParams: Promise<{ paket?: string }> }) {
  const { paket } = await searchParams;
  redirect(paket ? `/ucretsiz-deneme?paket=${encodeURIComponent(paket)}` : "/ucretsiz-deneme");
}
