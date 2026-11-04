import { redirect } from "next/navigation";
import { salonApp } from "./salon-app";
import { SalonPage, salonMetadata, salonViewport } from "./salon-page";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props) {
  return salonMetadata((await params).slug);
}
export async function generateViewport({ params }: Props) {
  return salonViewport((await params).slug);
}

/**
 * Online randevu sayfası. Bilinmeyen veya kapalı işletme gerçek 404 döner.
 * Salon uygulaması (PWA) açıksa kurulabilir adres /r/{slug}/uygulama'dır (uygulama kapsamı /r/{slug}/ içinde kalmalı);
 * eski bağlantılar oraya yönlendirilir. Bayraklar kapalıyken mevcut (anonim) akış aynen gösterilir.
 */
export default async function BookingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const app = await salonApp(slug);
  if (app && app !== "error" && app.features.installable) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") qs.set(k, v);
    redirect(`/r/${slug}/uygulama${qs.size ? `?${qs}` : ""}`);
  }
  return <SalonPage slug={slug} params={params} />;
}
