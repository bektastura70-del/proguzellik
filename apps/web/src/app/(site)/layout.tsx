import { SiteFooter, SiteHeader } from "@/components/site/site-shell";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-sand-50">
      <SiteHeader />
      <main id="icerik" className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
