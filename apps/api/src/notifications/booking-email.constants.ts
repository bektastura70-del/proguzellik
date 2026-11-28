/** Notification.template değerleri (kanal EMAIL) */
export const BOOKING_EMAIL = {
  staffNew: "eposta_isletme_yeni_randevu",
  staffCancel: "eposta_isletme_musteri_iptal",
  customerConfirm: "eposta_musteri_randevu_onay",
} as const;
export const BOOKING_EMAIL_TEMPLATES: string[] = Object.values(BOOKING_EMAIL);
/** İptal bildirimi randevu iptal edilmişken de gönderilir; diğerleri yalnızca randevu hâlâ planlıysa. */
export const BOOKING_EMAIL_NEEDS_ACTIVE: string[] = [BOOKING_EMAIL.staffNew, BOOKING_EMAIL.customerConfirm];

/** Müşterinin online iptal edebileceği en geç süre (saat) */
export const CUSTOMER_CANCEL_MIN_HOURS = 2;
