import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/panel", "/platform", "/api/", "/giris", "/davet", "/parola-sifirla", "/eposta-dogrula", "/ucretsiz-deneme/dogrula", "/guvenlik"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
