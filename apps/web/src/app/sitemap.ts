import type { MetadataRoute } from "next";
import { FEATURES } from "@/components/site/content";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["/", "/ozellikler", ...FEATURES.map((f) => `/ozellikler/${f.slug}`), "/fiyatlar", "/ucretsiz-deneme", "/sss", "/iletisim", "/hakkimizda", "/kvkk", "/gizlilik", "/cerez-politikasi", "/kullanim-kosullari"];
  return paths.map((p) => ({ url: `${SITE_URL}${p === "/" ? "" : p}`, changeFrequency: "monthly", priority: p === "/" ? 1 : 0.6 }));
}
