import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa-register";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ProGüzellik — Güzellik salonu yönetimi", template: "%s · ProGüzellik" },
  description: "Randevu, müşteri, kasa, paket ve stok yönetimi tek yerde. Güzellik salonları için Türkçe bulut yazılım.",
  applicationName: "ProGüzellik",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" },
  appleWebApp: { capable: true, title: "ProGüzellik", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#4a2535", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
