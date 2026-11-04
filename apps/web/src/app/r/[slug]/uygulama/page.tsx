import { notFound } from "next/navigation";
import { salonApp } from "../salon-app";
import { SalonPage, salonMetadata, salonViewport } from "../salon-page";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  return salonMetadata((await params).slug);
}
export async function generateViewport({ params }: Props) {
  return salonViewport((await params).slug);
}

/** Salon uygulamasının (PWA) başlangıç adresi. Uygulama kapalıysa 404 (eski akış /r/{slug} adresinde sürer). */
export default async function SalonAppPage({ params }: Props) {
  const { slug } = await params;
  const app = await salonApp(slug);
  if (!app || (app !== "error" && !app.features.installable)) notFound();
  return <SalonPage slug={slug} params={params} />;
}
