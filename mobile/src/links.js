/**
 * Uygulamanın açabileceği adresleri belirleyen saf işlevler (DOM yok; node --test ile denenir).
 * Uygulama yalnızca Pro Güzellik alan adındaki salon sayfalarını ve işletme girişini açar;
 * başka hiçbir adrese yönlendirme yapılmaz.
 */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

/** Uygulama içinde açılmasına izin verilen yollar (alan adı sabit, yalnız yol seçilir). */
const ALLOWED_PATHS = [
  /^\/r\/[a-z0-9-]+(?:\/[A-Za-z0-9._~%-]*)*$/, // salon sayfası ve alt sayfaları (iptal, hatırlatma kapatma...)
  /^\/giris$/,
  /^\/panel(?:\/[A-Za-z0-9._~%-]*)*$/,
  /^\/platform(?:\/[A-Za-z0-9._~%-]*)*$/,
  /^\/(davet|sifremi-unuttum|parola-sifirla|parola-degistir|eposta-dogrula|guvenlik)$/,
  /^\/salonlar(?:\/[a-z0-9-]+){0,2}$/, // salon rehberi: il > ilçe > salon
];

export function isAllowedPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return false;
  const bare = path.split(/[?#]/)[0];
  if (bare.includes("..")) return false;
  return ALLOWED_PATHS.some((re) => re.test(bare));
}

function hostOf(base) {
  return new URL(base).host;
}

/**
 * Müşterinin yazdığı ya da QR'dan okunan metinden salon kodunu çıkarır.
 * Kabul: "https://proguzellik.com/r/salon", "proguzellik.com/r/salon/uygulama", "www.proguzellik.com/r/salon", "salon".
 * Başka bir alan adındaki bağlantı reddedilir (null).
 */
export function parseSalonInput(input, base) {
  if (typeof input !== "string") return null;
  let text = input.trim();
  if (!text) return null;
  const host = hostOf(base).replace(/^www\./, "");
  if (SLUG_RE.test(text.toLowerCase()) && !text.includes(".")) return text.toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = "https://" + text;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === "proguzellik:") {
    // proguzellik://r/salon → host "r", yol "/salon"
    const parts = [url.host, ...url.pathname.split("/")].filter(Boolean);
    return parts[0] === "r" && parts[1] && SLUG_RE.test(parts[1].toLowerCase()) ? parts[1].toLowerCase() : null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.host.replace(/^www\./, "") !== host) return null;
  const m = /^\/r\/([^/]+)/.exec(url.pathname);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).toLowerCase();
  return SLUG_RE.test(slug) ? slug : null;
}

/**
 * Derin bağlantıyı (proguzellik://..., https://proguzellik.com/...) uygulama içinde açılacak yola çevirir.
 * İzin verilmeyen her şey null döner (uygulama giriş ekranında kalır).
 */
export function deepLinkToPath(link, base) {
  if (typeof link !== "string" || !link) return null;
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  let path;
  if (url.protocol === "proguzellik:") {
    path = "/" + [url.host, ...url.pathname.split("/")].filter(Boolean).join("/");
  } else if (url.protocol === "https:" && url.host.replace(/^www\./, "") === hostOf(base).replace(/^www\./, "")) {
    path = url.pathname;
  } else {
    return null;
  }
  const full = path + (url.search || "");
  return isAllowedPath(full) ? full : null;
}

const LOGO_RE = /^\/r\/([a-z0-9-]+)\/marka\/[0-9a-f-]{36}$/;

/**
 * Siteden gelen salon adı/logosu (yalnızca görüntü için; HTML olarak yazılmaz). Logo yalnızca o salonun
 * Pro Güzellik'teki marka adresi olabilir; başka her şey yok sayılır.
 */
export function cleanSalonMeta(slug, name, logo) {
  const n = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const m = typeof logo === "string" ? LOGO_RE.exec(logo) : null;
  return { name: n || null, logo: m && m[1] === slug ? logo : null };
}

/** Son açılan salonlar listesi: en yeni başta, en çok 6, tekrar yok. Ad/logo verilmezse önceki değer korunur. */
export function rememberSalon(list, slug, name, now = Date.now(), logo = null) {
  const arr = Array.isArray(list) ? list : [];
  const clean = arr.filter((s) => s && typeof s.slug === "string" && s.slug !== slug);
  const prev = arr.find((s) => s && s.slug === slug);
  return [{ slug, name: name || prev?.name || null, logo: logo || prev?.logo || null, at: now }, ...clean].slice(0, 6);
}

/** Salonun adını/logosunu günceller ama sırasını değiştirmez (listede yoksa eklemez). */
export function updateSalonMeta(list, slug, name, logo) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map((s) => (s && s.slug === slug ? { ...s, name: name || s.name || null, logo: logo || s.logo || null } : s));
}

/** Salonu cihazdaki son salonlar listesinden kaldırır (hesap veya oturum silinmez). */
export function forgetSalon(list, slug) {
  return (Array.isArray(list) ? list : []).filter((s) => s && s.slug !== slug);
}
