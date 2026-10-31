"use client";

import {
  BarChart3, Bell, Boxes, MessageCircle, Link2, CalendarDays, CreditCard, LayoutDashboard, LogOut, Menu, Package, Scissors, Settings, Sparkles, Users, UserSquare2, Wallet, X, Shield,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Alert, Badge, Spinner } from "@/components/ui";
import { STATUS_TR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Membership, useSession } from "./session";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; roles?: Membership["role"][]; feature?: string };

const NAV: Item[] = [
  { href: "/panel", label: "Genel bakış", icon: LayoutDashboard },
  { href: "/panel/takvim", label: "Takvim", icon: CalendarDays },
  { href: "/panel/musteriler", label: "Müşteriler", icon: Users },
  { href: "/panel/hizmetler", label: "Hizmetler", icon: Scissors, roles: ["OWNER", "MANAGER"] },
  { href: "/panel/personel", label: "Personel", icon: UserSquare2, roles: ["OWNER", "MANAGER"] },
  { href: "/panel/paketler", label: "Paketler", icon: Package },
  { href: "/panel/kasa", label: "Kasa", icon: Wallet, roles: ["OWNER", "MANAGER", "RECEPTION"] },
  { href: "/panel/stok", label: "Stok", icon: Boxes, feature: "STOCK" },
  { href: "/panel/raporlar", label: "Raporlar", icon: BarChart3, roles: ["OWNER", "MANAGER"], feature: "REPORTS" },
  { href: "/panel/kanallar", label: "WhatsApp & Instagram", icon: Link2, roles: ["OWNER", "MANAGER"], feature: "WHATSAPP" },
  { href: "/panel/bildirimler", label: "Bildirimler", icon: Bell, roles: ["OWNER", "MANAGER", "RECEPTION"], feature: "WHATSAPP" },
  { href: "/panel/asistan", label: "Asistan", icon: Sparkles, roles: ["OWNER", "MANAGER"], feature: "AI_ASSISTANT" },
  { href: "/panel/abonelik", label: "Abonelik", icon: CreditCard, roles: ["OWNER", "MANAGER"] },
  { href: "/panel/ayarlar", label: "Ayarlar", icon: Settings, roles: ["OWNER", "MANAGER"] },
];

export function PanelShell({ children }: { children: React.ReactNode }) {
  const { me, current, can, has, switchTenant, logout } = useSession();
  const path = usePathname();
  const [open, setOpen] = useState(false);

  if (!me) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="mx-auto max-w-md p-6 pt-24 text-center">
        <Logo />
        <p className="mt-6 text-neutral-600">Hesabınıza bağlı bir işletme yok.</p>
        {me.isPlatformAdmin && (
          <Link href="/platform" className="mt-4 inline-block text-brand-700 underline">SaaS yönetim paneline git</Link>
        )}
        <button onClick={logout} className="mt-4 block w-full text-sm text-neutral-500 underline">Çıkış yap</button>
      </div>
    );
  }

  const items = NAV.filter((i) => (!i.roles || can(...i.roles)) && (!i.feature || has(i.feature)));
  const trialDays = current.tenant.status === "TRIAL" && current.tenant.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(current.tenant.trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null;

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
      {items.map((i) => {
        const active = i.href === "/panel" ? path === "/panel" : path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
              active ? "bg-brand-700 text-white" : "text-brand-100/90 hover:bg-white/10 hover:text-white",
            )}
          >
            <i.icon className="size-[18px]" />
            {i.label}
          </Link>
        );
      })}
      {me.isPlatformAdmin && (
        <Link href="/platform" className="mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-brand-100/90 hover:bg-white/10">
          <Shield className="size-[18px]" /> SaaS yönetimi
        </Link>
      )}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-900 text-white">
      <div className="flex items-center justify-between px-5 py-5">
        <Logo light />
        <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Menüyü kapat">
          <X className="size-5" />
        </button>
      </div>
      <div className="px-4">
        {me.memberships.length > 1 ? (
          <select
            className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white"
            value={current.tenant.id}
            onChange={(e) => switchTenant(e.target.value)}
            aria-label="İşletme seç"
          >
            {me.memberships.map((m) => (
              <option key={m.tenant.id} value={m.tenant.id} className="text-ink">{m.tenant.name}</option>
            ))}
          </select>
        ) : (
          <div className="rounded-xl bg-white/10 px-3 py-2 text-sm">{current.tenant.name}</div>
        )}
        <div className="mt-2 flex items-center gap-2 px-1 text-xs text-brand-100/80">
          <span>{current.tenant.plan.name}</span>·<span>{STATUS_TR[current.tenant.status]}</span>
        </div>
      </div>
      {nav}
      <div className="border-t border-white/10 px-5 py-4 text-sm">
        <div className="truncate font-medium">{me.fullName}</div>
        <div className="truncate text-xs text-brand-100/70">{me.email}</div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/guvenlik" className="text-xs text-brand-100/80 hover:text-white">Hesap güvenliği</Link>
          <button onClick={logout} className="inline-flex items-center gap-2 text-xs text-brand-100/80 hover:text-white">
            <LogOut className="size-4" /> Çıkış yap
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-sand-200 bg-sand-50/90 px-4 py-3 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Menüyü aç" className="rounded-lg p-1.5 hover:bg-sand-100">
          <Menu className="size-6" />
        </button>
        <Logo className="text-lg" />
        <span className="w-8" />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        {me.emailVerified === false && (
          <div className="mb-6">
            <Alert tone="amber">
              E-posta adresiniz henüz doğrulanmadı. <Link href="/guvenlik" className="font-medium underline">Doğrulama e-postasını tekrar gönder</Link>
            </Alert>
          </div>
        )}
        {trialDays !== null && (
          <div className="mb-6">
            <Alert tone={trialDays <= 3 ? "amber" : "brand"}>
              Deneme sürenizin bitmesine <b>{trialDays} gün</b> kaldı.{" "}
              {can("OWNER") && <Link href="/panel/abonelik" className="font-medium underline">Paket seçin</Link>}
            </Alert>
          </div>
        )}
        {["PAST_DUE", "CANCELLED"].includes(current.tenant.status) && (
          <div className="mb-6">
            <Alert tone="amber">
              Aboneliğiniz {current.tenant.status === "PAST_DUE" ? "ödeme bekliyor" : "sona erdi"}. <Link href="/panel/abonelik" className="font-medium underline">Abonelik sayfasına gidin</Link>
            </Alert>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone="brand">{role}</Badge>;
}
