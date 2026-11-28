/**
 * Bu cihazda alınan online randevuların iptal bağlantıları (yalnızca tarayıcıda, sunucuya gitmez).
 * Müşteri sayfaya döndüğünde "Randevularınız" kartında görür; bağlantıyı kaybetse de iptal edebilir.
 * Not: iPhone'da ana ekrana eklenmiş uygulama ile Safari ayrı depolama kullanır.
 */
export type SavedBooking = { id: string; token: string; service: string; staff: string; startsAt: string };

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
