/**
 * Push aboneliği doğrulaması. Gönderim işçisi abonelik adresine sunucudan istek attığı için adres yalnızca bilinen
 * tarayıcı push servislerinden biri olabilir (aksi hâlde iç ağa istek attırılabilir: SSRF).
 */
const PUSH_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Android), Samsung, Opera
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge (Windows)
  /^web\.push\.apple\.com$/, // Safari / iOS 16.4+ (ana ekrana eklenmiş uygulama)
  /^[a-z0-9-]+\.push\.apple\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  return PUSH_HOSTS.some((re) => re.test(u.hostname));
}

/** Tarayıcının verdiği anahtarlar base64url: p256dh 65 bayt (≈87 karakter), auth 16 bayt (≈22 karakter). */
export const P256DH_RE = /^[A-Za-z0-9_-]{80,100}={0,2}$/;
export const AUTH_RE = /^[A-Za-z0-9_-]{16,32}={0,2}$/;
