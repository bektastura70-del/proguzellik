/** Notification.template değerleri (kanal EMAIL) */
export const BOOKING_EMAIL = {
  staffNew: "eposta_isletme_yeni_randevu",
  staffCancel: "eposta_isletme_musteri_iptal",
  customerConfirm: "eposta_musteri_randevu_onay",
  /** Salon kararı (onay, saat değişikliği, iptal/ret): yalnız online formda e-posta verilmiş randevularda */
  customerConfirmed: "eposta_musteri_randevu_onaylandi",
  customerRescheduled: "eposta_musteri_saat_degisti",
  customerDeclined: "eposta_musteri_salon_iptal",
} as const;
export const BOOKING_EMAIL_TEMPLATES: string[] = Object.values(BOOKING_EMAIL);
/** İptal bildirimi randevu iptal edilmişken de gönderilir; diğerleri yalnızca randevu hâlâ planlıysa. */
export const BOOKING_EMAIL_NEEDS_ACTIVE: string[] = [BOOKING_EMAIL.staffNew, BOOKING_EMAIL.customerConfirm, BOOKING_EMAIL.customerConfirmed, BOOKING_EMAIL.customerRescheduled];

/** Müşterinin online iptal edebileceği en geç süre (saat) */
export const CUSTOMER_CANCEL_MIN_HOURS = 2;
