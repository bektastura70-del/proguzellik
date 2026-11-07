// JS (TS değil): canlı imajda TypeScript olmadan yüklenebilsin.

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

/**
 * Yalnız iyzico ödeme sayfası: iyzico'nun ödeme formu kendi alan adlarından betik, çerçeve ve istek yükler.
 * Sitenin geri kalanında sıkı politika aynen kalır.
 */
const IYZICO = "https://*.iyzipay.com https://*.iyzico.com";
const paymentPageHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${IYZICO}`,
      `style-src 'self' 'unsafe-inline' ${IYZICO}`,
      `img-src 'self' data: blob: ${IYZICO}`,
      `font-src 'self' data: ${IYZICO}`,
      `connect-src 'self' ${IYZICO}`,
      `frame-src ${IYZICO}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      `form-action 'self' ${IYZICO}`,
    ].join("; "),
  },
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async redirects() {
    // Eski SaaS sahibi adresi; tek alan adında yönetim /platform altındadır.
    return [
      { source: "/yonetim", destination: "/platform", permanent: true },
      { source: "/yonetim/:path*", destination: "/platform/:path*", permanent: true },
    ];
  },
  async headers() {
    // Sonraki eşleşme aynı başlığı ezer: ödeme sayfası yalnız CSP'de gevşetilir.
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/panel/abonelik/odeme", headers: paymentPageHeaders },
    ];
  },
};

export default nextConfig;
