"use client";

import { Home } from "lucide-react";
import { useEffect, useState } from "react";
import { isNativeApp, nativeHomeUrl } from "@/lib/native-app";

/** Uygulamanın giriş ekranına (salon değiştir / işletme girişi) dönüş bağlantısı. */
export function NativeHomeLink({ className, light }: { className?: string; light?: boolean }) {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => setHref(isNativeApp() ? nativeHomeUrl() : null), []);
  if (!href) return null;
  return (
    <a href={href} className={className ?? `inline-flex min-h-11 items-center gap-1.5 text-sm underline-offset-2 hover:underline ${light ? "text-white/90" : "text-neutral-600"}`}>
      <Home className="size-4" aria-hidden /> Salon değiştir
    </a>
  );
}
