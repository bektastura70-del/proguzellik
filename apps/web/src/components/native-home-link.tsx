"use client";

import { Home, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { isNativeApp, nativeHomeUrl } from "@/lib/native-app";

const linkClass = (light?: boolean) =>
  `inline-flex min-h-11 items-center gap-1.5 text-sm underline-offset-2 hover:underline ${light ? "text-white/90" : "text-neutral-600"}`;

/** Uygulamanın giriş ekranına (salon değiştir / işletme girişi) dönüş bağlantısı. */
export function NativeHomeLink({ className, light, label = "Salon değiştir" }: { className?: string; light?: boolean; label?: string }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    setHref(isNativeApp() ? nativeHomeUrl() : null);
  }, []);
  if (!href) return null;
  return (
    <a href={href} className={className ?? linkClass(light)}>
      <Home className="size-4" aria-hidden /> {label}
    </a>
  );
}

/** Yalnızca uygulamada: şehir/ilçe ile başka salon bulma (salon rehberi). */
export function NativeDirectoryLink({ className, light }: { className?: string; light?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(isNativeApp());
  }, []);
  if (!show) return null;
  return (
    <a href="/salonlar" className={className ?? linkClass(light)}>
      <Search className="size-4" aria-hidden /> Salon bul
    </a>
  );
}
