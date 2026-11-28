/**
 * Müşterinin isteğiyle bu cihazda hatırlanan randevu bilgileri (yalnızca tarayıcı/uygulama deposunda, sunucuya gitmez).
 * - İletişim bilgileri (ad, soyad, telefon, e-posta): yalnızca müşteri "Bilgilerimi bu cihazda hatırla" seçerse,
 *   yalnızca kendi yazdıklarından kaydedilir. Tüm salonlarda ortaktır; "Bilgilerimi unut" ile silinir.
 * - Son seçim (hizmet + uzman): salon başına, "Tekrar al" için. Kişisel veri içermez.
 * Sunucudaki eşleşen müşteri kaydından hiçbir zaman doldurulmaz.
 */
export type SavedContact = { firstName: string; lastName: string; phone: string; email?: string };
export type LastChoice = { serviceId: string; staffId: string; service: string; staff: string };

const CONTACT_KEY = "pg_contact";
const lastKey = (slug: string) => `pg_last:${slug}`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function loadContact(): SavedContact | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTACT_KEY) ?? "null") as Partial<SavedContact> | null;
    if (!raw) return null;
    const c = { firstName: str(raw.firstName, 80), lastName: str(raw.lastName, 80), phone: str(raw.phone, 30), email: str(raw.email, 200) || undefined };
    return c.firstName || c.phone ? c : null;
  } catch {
    return null;
  }
}

export function saveContact(c: SavedContact) {
  try {
    localStorage.setItem(
      CONTACT_KEY,
      JSON.stringify({ firstName: str(c.firstName, 80), lastName: str(c.lastName, 80), phone: str(c.phone, 30), ...(str(c.email, 200) ? { email: str(c.email, 200) } : {}) }),
    );
  } catch {
    /* depolama kapalı */
  }
}

export function forgetContact() {
  try {
    localStorage.removeItem(CONTACT_KEY);
  } catch {
    /* depolama kapalı */
  }
}

export function loadLastChoice(slug: string): LastChoice | null {
  try {
    const raw = JSON.parse(localStorage.getItem(lastKey(slug)) ?? "null") as Partial<LastChoice> | null;
    if (!raw || typeof raw.serviceId !== "string" || !raw.serviceId) return null;
    return { serviceId: raw.serviceId, staffId: typeof raw.staffId === "string" ? raw.staffId : "", service: str(raw.service, 120), staff: str(raw.staff, 120) };
  } catch {
    return null;
  }
}

export function saveLastChoice(slug: string, c: LastChoice) {
  try {
    localStorage.setItem(lastKey(slug), JSON.stringify(c));
  } catch {
    /* depolama kapalı */
  }
}
