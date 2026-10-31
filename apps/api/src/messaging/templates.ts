/**
 * İşletmenin kendi WhatsApp Business hesabında Meta'ya onaylatması gereken şablonlar.
 * Gövde metinleri Meta'ya birebir girilecek metinlerdir ({{1}}… değişkenleri sırasıyla `params`).
 * Not: Bu metinler Meta tarafından henüz hiçbir hesapta onaylanmadı; onay işletmenin kendi hesabında yapılır.
 */
export type TemplateName =
  | "randevu_onay"
  | "randevu_hatirlatma"
  | "randevu_iptal"
  | "paket_hatirlatma"
  | "tekrar_randevu"
  | "kampanya_duyuru";

export interface TemplateDef {
  name: TemplateName;
  /** Meta kategorisi: UTILITY (hizmet bildirimi) · MARKETING (ticari ileti; açık rıza + İYS gerekir) */
  category: "UTILITY" | "MARKETING";
  label: string;
  body: string;
  params: string[];
}

export const TEMPLATES: TemplateDef[] = [
  {
    name: "randevu_onay",
    category: "UTILITY",
    label: "Randevu onayı",
    body: "Merhaba {{1}}, {{2}} randevunuz oluşturuldu: {{3}} – {{4}} {{5}}. Görüşmek üzere!",
    params: ["Müşteri adı", "İşletme adı", "Hizmet", "Tarih", "Saat"],
  },
  {
    name: "randevu_hatirlatma",
    category: "UTILITY",
    label: "Randevu hatırlatma (24 saat önce)",
    body: "Merhaba {{1}}, yarın {{4}} {{5}} saatinde {{2}} – {{3}} randevunuz var.",
    params: ["Müşteri adı", "İşletme adı", "Hizmet", "Tarih", "Saat"],
  },
  {
    name: "randevu_iptal",
    category: "UTILITY",
    label: "Randevu iptali",
    body: "Merhaba {{1}}, {{2}} – {{3}} ({{4}} {{5}}) randevunuz iptal edildi.",
    params: ["Müşteri adı", "İşletme adı", "Hizmet", "Tarih", "Saat"],
  },
  {
    name: "paket_hatirlatma",
    category: "UTILITY",
    label: "Paket bitiş hatırlatması",
    body: "Merhaba {{1}}, {{2}} paketinizin süresi {{3}} tarihinde doluyor ve {{4}} seansınız kaldı. Randevu almak için bu mesaja yanıt verebilirsiniz. – {{5}}",
    params: ["Müşteri adı", "Paket adı", "Bitiş tarihi", "Kalan seans", "İşletme adı"],
  },
  {
    name: "tekrar_randevu",
    category: "UTILITY",
    label: "Tekrar randevu zamanı",
    body: "Merhaba {{1}}, son {{2}} işleminizin üzerinden {{3}} gün geçti. Bir sonraki seans için randevu almak isterseniz bu mesaja yanıt verebilirsiniz. – {{4}}",
    params: ["Müşteri adı", "Hizmet", "Geçen gün", "İşletme adı"],
  },
  {
    name: "kampanya_duyuru",
    category: "MARKETING",
    label: "Kampanya duyurusu (ticari ileti)",
    body: "Merhaba {{1}}, {{2}}: {{3}} Ayrıntı ve randevu için bu mesaja yanıt verebilirsiniz. Bu tür mesajları almak istemiyorsanız RET yazmanız yeterli.",
    params: ["Müşteri adı", "İşletme adı", "Kampanya metni"],
  },
];

export const templateDef = (name: string) => TEMPLATES.find((t) => t.name === name);

/** Şablon gövdesini değişkenlerle doldurur (önizleme ve gelen kutusu kaydı için). */
export function renderTemplate(name: string, p: string[]): string {
  const def = templateDef(name);
  if (!def) return `[${name}] ${p.join(" · ")}`;
  return def.body.replace(/\{\{(\d+)\}\}/g, (_, i: string) => p[Number(i) - 1] ?? "");
}
