import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ProGüzellik — Salon Yönetimi",
    short_name: "ProGüzellik",
    description: "Güzellik salonları için randevu, müşteri ve kasa yönetimi",
    start_url: "/panel",
    scope: "/",
    display: "standalone",
    background_color: "#faf8f5",
    theme_color: "#4a2535",
    lang: "tr",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
