"use client";

import { useEffect } from "react";

/** Service worker yalnızca üretim derlemesinde kaydedilir (geliştirmede önbellek karışıklığını önler). */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    // Salon sayfaları (/r/…) işletme uygulamasının service worker'ını kaydetmez; kendi kapsamlı worker'ları vardır.
    if (window.location.pathname.startsWith("/r/")) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
