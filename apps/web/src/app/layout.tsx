import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProGüzellik",
  description: "Güzellik salonları için yönetim platformu",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
