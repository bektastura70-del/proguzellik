const TZ = "Europe/Istanbul";

export const tl = (v: string | number | null | undefined) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(Number(v ?? 0));

export const dateTr = (d: string | Date, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, ...opts }).format(new Date(d));

export const timeTr = (d: string | Date) => new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d));

export const dateTimeTr = (d: string | Date) => `${dateTr(d, { day: "numeric", month: "short" })} ${timeTr(d)}`;

/** İstanbul saatine göre YYYY-MM-DD */
export const isoDay = (d: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** İstanbul (UTC+3, yaz saati yok) yerel tarih+saat → ISO */
export const istanbulToIso = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+03:00`).toISOString();

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};

export const minutesToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const hhmmToMinutes = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

export const WEEKDAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];

export const STATUS_TR: Record<string, string> = {
  BOOKED: "Bekliyor",
  CONFIRMED: "Onaylandı",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  NO_SHOW: "Gelmedi",
  TRIAL: "Deneme",
  ACTIVE: "Aktif",
  PAST_DUE: "Ödeme bekliyor",
  SUSPENDED: "Askıda",
  EXPIRED: "Süresi doldu",
  QUEUED: "Sırada",
  SENT: "Gönderildi",
  DELIVERED: "Teslim edildi",
  READ: "Okundu",
  FAILED: "Başarısız",
  SKIPPED: "Atlandı",
};

export const ROLE_TR: Record<string, string> = { OWNER: "İşletme sahibi", MANAGER: "Yönetici", RECEPTION: "Resepsiyon", STAFF: "Personel" };
export const METHOD_TR: Record<string, string> = { CASH: "Nakit", CARD: "Kart", TRANSFER: "Havale/EFT", OTHER: "Diğer" };
export const TYPE_TR: Record<string, string> = { INCOME: "Gelir", EXPENSE: "Gider", REFUND: "İade" };
