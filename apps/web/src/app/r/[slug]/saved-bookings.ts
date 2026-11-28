/**
 * Bu cihazda alınan online randevuların iptal bağlantıları (yalnızca tarayıcıda, sunucuya gitmez).
 * Müşteri sayfaya döndüğünde "Randevularınız" kartında görür; bağlantıyı kaybetse de iptal edebilir.
 * Not: iPhone'da ana ekrana eklenmiş uygulama ile Safari ayrı depolama kullanır.
 */
export type SavedBooking = {
  id: string; token: string; service: string; staff: string; startsAt: string;
  /** Sunucudan son yenilenen durum (BOOKED, CONFIRMED, CANCELLED…); eski kayıtlarda yok. */
  status?: string;
};

const key = (slug: string) => `pg_bookings:${slug}`;

export function loadSavedBookings(slug: string): SavedBooking[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(slug)) ?? "[]") as SavedBooking[];
    // Geçmiş randevular (1 gün sonra) listeden düşer.
    return raw.filter((b) => b && b.id && b.token && new Date(b.startsAt).getTime() > Date.now() - 86_400_000);
  } catch {
    return [];
  }
}

export function saveBooking(slug: string, b: SavedBooking) {
  try {
    const list = [b, ...loadSavedBookings(slug).filter((x) => x.id !== b.id)].slice(0, 10);
    localStorage.setItem(key(slug), JSON.stringify(list));
  } catch {
    /* depolama kapalı (gizli sekme vb.) */
  }
}

export function forgetBooking(slug: string, id: string) {
  try {
    localStorage.setItem(key(slug), JSON.stringify(loadSavedBookings(slug).filter((x) => x.id !== id)));
  } catch {
    /* depolama kapalı */
  }
}

export const cancelHref = (slug: string, b: { id: string; token: string }) => `/r/${slug}/iptal?id=${b.id}&t=${encodeURIComponent(b.token)}`;

const REFRESH_KEY = (slug: string) => `pg_bookings_checked:${slug}`;
const REFRESH_EVERY_MS = 10 * 60_000;

/**
 * Kayıtlı randevuların güncel durumunu ve saatini iptal bağlantısıyla sunucudan okur (salon iptal ettiyse
 * ya da saati değiştirdiyse liste doğru görünür). Ad/telefon dönmez. Aynı sekmede 10 dakikada bir yapılır;
 * ağ hatasında eldeki liste korunur. Bağlantısı geçersiz ya da silinmiş randevu listeden düşer.
 */
export async function refreshSavedBookings(slug: string, force = false): Promise<SavedBooking[]> {
  const list = loadSavedBookings(slug);
  if (!list.length) return list;
  try {
    const last = Number(sessionStorage.getItem(REFRESH_KEY(slug)) ?? 0);
    if (!force && Date.now() - last < REFRESH_EVERY_MS) return list;
    sessionStorage.setItem(REFRESH_KEY(slug), String(Date.now()));
  } catch {
    /* depolama kapalı: yine de yenilenir */
  }
  const next: SavedBooking[] = [];
  for (const b of list) {
    // Sonuçlanmış ya da saati geçmiş randevu yeniden sorulmaz (sorgu sınırı ortak IP'lerde de yetsin).
    if (["CANCELLED", "COMPLETED", "NO_SHOW"].includes(b.status ?? "") || new Date(b.startsAt).getTime() < Date.now()) {
      next.push(b);
      continue;
    }
    try {
      const r = await fetch(`/api/p/public/salons/${slug}/bookings/${b.id}?token=${encodeURIComponent(b.token)}`, { cache: "no-store" });
      if (r.status === 403 || r.status === 404) continue;
      if (!r.ok) {
        next.push(b);
        continue;
      }
      const d = (await r.json()) as { service: string; staff: string; startsAt: string; status: string };
      next.push({ ...b, service: d.service, staff: d.staff, startsAt: new Date(d.startsAt).toISOString(), status: d.status });
    } catch {
      next.push(b);
    }
  }
  // Yenileme sürerken eklenen yeni randevu kaybolmasın.
  const added = loadSavedBookings(slug).filter((x) => !list.some((b) => b.id === x.id));
  try {
    localStorage.setItem(key(slug), JSON.stringify([...added, ...next].slice(0, 10)));
  } catch {
    /* depolama kapalı */
  }
  return loadSavedBookings(slug);
}
