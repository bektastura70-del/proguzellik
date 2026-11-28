const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type EmailTemplate =
  | { name: "password_reset"; vars: { fullName: string; link: string; minutes: number } }
  | { name: "password_changed"; vars: { fullName: string } }
  | { name: "email_verify"; vars: { fullName: string; link: string } }
  | { name: "trial_verify"; vars: { fullName: string; salon: string; link: string; hours: number } }
  | { name: "trial_application_verify"; vars: { fullName: string; salon: string; link: string; hours: number } }
  | { name: "trial_application_received"; vars: { salon: string; link: string } }
  | { name: "signup_exists"; vars: { fullName: string; link: string } }
  | { name: "purchase_verify"; vars: { fullName: string; salon: string; plan: string; link: string; hours: number } }
  | { name: "purchase_exists"; vars: { fullName: string; link: string } }
  | { name: "purchase_completed"; vars: { fullName: string; salon: string; plan: string; amount: string; until: string; link: string } }
  | { name: "purchase_received"; vars: { salon: string; plan: string; amount: string; link: string } }
  | { name: "mfa_enabled"; vars: { fullName: string } }
  | { name: "mfa_reset"; vars: { fullName: string } }
  | { name: "tenant_invite"; vars: { fullName: string; salon: string; link: string; days: number; role?: string } }
  | { name: "trial_ending"; vars: { salon: string; days: number; link: string } }
  | { name: "trial_ended"; vars: { salon: string; link: string } }
  | { name: "payment_failed"; vars: { salon: string; graceDays: number; link: string } }
  | { name: "subscription_renewed"; vars: { salon: string; plan: string; amount: string; until: string } }
  | { name: "subscription_cancelled"; vars: { salon: string; link: string } }
  | { name: "subscription_expired"; vars: { salon: string; graceDays: number; link: string } }
  | { name: "plan_limit_exceeded"; vars: { salon: string; active: number; max: number; link: string } }
  | { name: "subscription_started"; vars: { salon: string; plan: string; until: string; complimentary: boolean; link: string } }
  | { name: "payment_reminder"; vars: { salon: string; description: string; amount: string; dueDate: string; payTo?: string } }
  | { name: "invoice_notice"; vars: { salon: string; number: string; amount: string; date: string } }
  | { name: "owner_notice"; vars: { subject: string; body: string; salon?: string } }
  | { name: "customer_otp"; vars: { salon: string; code: string; minutes: number } }
  | { name: "low_stock_alert"; vars: { salon: string; count: number; items: string; link: string } }
  | { name: "renewal_reminder"; vars: { salon: string; firstName: string; service: string; dueDate: string; link: string; phone?: string; optOutLink: string } }
  | { name: "ai_quota_low"; vars: { salon: string; link: string; canBuy?: boolean } }
  | { name: "ai_quota_empty"; vars: { salon: string; link: string; canBuy?: boolean } }
  | { name: "ai_credit_purchased"; vars: { salon: string; link: string; amount: string } }
  | { name: "ai_daily_cap"; vars: { salon: string; slug: string; limitUsd: string; link: string } }
  | { name: "ai_fx_stale"; vars: { detail: string; link: string } }
  | { name: "booking_new_staff"; vars: { salon: string; customer: string; phone?: string; service: string; staff: string; when: string; source: string; notes?: string; link: string } }
  | { name: "booking_cancelled_staff"; vars: { salon: string; customer: string; phone?: string; service: string; staff: string; when: string; link: string } }
  | { name: "booking_confirmation_customer"; vars: { salon: string; firstName: string; service: string; staff: string; when: string; address?: string; phone?: string; cancelLink: string; cancelHours: number } }
  | { name: "booking_confirmed_customer"; vars: { salon: string; firstName: string; service: string; staff: string; when: string; address?: string; phone?: string; cancelLink: string; cancelHours: number } }
  | { name: "booking_rescheduled_customer"; vars: { salon: string; firstName: string; service: string; staff: string; when: string; previousWhen: string; phone?: string; cancelLink: string; cancelHours: number } }
  | { name: "booking_declined_customer"; vars: { salon: string; firstName: string; service: string; when: string; reason?: string; phone?: string; bookLink: string } };

export type TemplateName = EmailTemplate["name"];

/**
 * Şablon bilgisi. secret: bağlantıda tek kullanımlık belirteç vardır (değişkenler kaydedilmez, yeniden deneme
 * ilgili akıştan yapılır). editable: SaaS sahibi konu/metni değiştirebilir (güvenlik e-postaları sabittir).
 */
export const TEMPLATE_META: Record<TemplateName, { label: string; vars: string[]; secret: boolean; editable: boolean }> = {
  password_reset: { label: "Parola sıfırlama", vars: ["fullName", "minutes"], secret: true, editable: false },
  password_changed: { label: "Parola değişti", vars: ["fullName"], secret: false, editable: false },
  email_verify: { label: "E-posta doğrulama", vars: ["fullName"], secret: true, editable: false },
  trial_verify: { label: "Ücretsiz deneme: e-posta doğrulama", vars: ["fullName", "salon", "hours"], secret: true, editable: false },
  trial_application_verify: { label: "Deneme başvurusu: e-posta doğrulama", vars: ["fullName", "salon", "hours"], secret: true, editable: false },
  trial_application_received: { label: "Deneme başvurusu: SaaS sahibine bildirim", vars: ["salon"], secret: false, editable: false },
  signup_exists: { label: "Kayıt denemesi: hesap zaten var", vars: ["fullName"], secret: false, editable: false },
  purchase_verify: { label: "Paket satın alma: e-posta doğrulama", vars: ["fullName", "salon", "plan", "hours"], secret: true, editable: false },
  purchase_exists: { label: "Paket satın alma denemesi: hesap zaten var", vars: ["fullName"], secret: false, editable: false },
  purchase_completed: { label: "Paket satın alındı: hesap açıldı", vars: ["fullName", "salon", "plan", "amount", "until"], secret: false, editable: false },
  purchase_received: { label: "Paket satın alındı: SaaS sahibine bildirim", vars: ["salon", "plan", "amount"], secret: false, editable: false },
  mfa_enabled: { label: "2FA açıldı", vars: ["fullName"], secret: false, editable: false },
  mfa_reset: { label: "2FA sıfırlandı", vars: ["fullName"], secret: false, editable: false },
  tenant_invite: { label: "Kullanıcı daveti", vars: ["fullName", "salon", "days", "role"], secret: true, editable: false },
  trial_ending: { label: "Deneme bitiyor (7/3/1 gün)", vars: ["salon", "days"], secret: false, editable: true },
  trial_ended: { label: "Deneme bitti", vars: ["salon"], secret: false, editable: true },
  payment_failed: { label: "Ödeme alınamadı", vars: ["salon", "graceDays"], secret: false, editable: true },
  subscription_renewed: { label: "Abonelik yenilendi", vars: ["salon", "plan", "amount", "until"], secret: false, editable: true },
  subscription_cancelled: { label: "Abonelik sona erdi", vars: ["salon"], secret: false, editable: true },
  subscription_expired: { label: "Abonelik süresi doldu", vars: ["salon", "graceDays"], secret: false, editable: true },
  plan_limit_exceeded: { label: "Personel sınırı aşıldı", vars: ["salon", "active", "max"], secret: false, editable: true },
  subscription_started: { label: "Abonelik başladı", vars: ["salon", "plan", "until"], secret: false, editable: true },
  payment_reminder: { label: "Ödeme hatırlatması", vars: ["salon", "description", "amount", "dueDate", "payTo"], secret: false, editable: true },
  invoice_notice: { label: "Fatura bildirimi", vars: ["salon", "number", "amount", "date"], secret: false, editable: true },
  owner_notice: { label: "SaaS sahibi bilgilendirmesi", vars: ["subject", "body"], secret: false, editable: false },
  customer_otp: { label: "Müşteri portalı doğrulama kodu", vars: ["salon", "minutes"], secret: true, editable: false },
  // secret: değişkenler (vazgeçme belirteci) saklanmaz ve e-posta merkezinden elle yeniden gönderilemez.
  // Yeniden deneme yalnızca kuyruktan yapılır; orada izin/vazgeçme/randevu/tarih her denemede yeniden denetlenir.
  low_stock_alert: { label: "Kritik stok uyarısı (işletme sahibi ve yöneticilere)", vars: ["salon", "count"], secret: false, editable: false },
  renewal_reminder: { label: "Yenilenme hatırlatması (salon müşterisine)", vars: ["salon", "firstName", "service", "dueDate"], secret: true, editable: false },
  ai_quota_low: { label: "Yapay zekâ kullanım hakkı azaldı", vars: ["salon"], secret: false, editable: false },
  ai_quota_empty: { label: "Yapay zekâ kullanım hakkı doldu", vars: ["salon"], secret: false, editable: false },
  ai_credit_purchased: { label: "Yapay zekâ ek paketi alındı", vars: ["salon", "amount"], secret: false, editable: false },
  ai_fx_stale: { label: "Yapay zekâ: TCMB kuru güncellenemedi (SaaS sahibine)", vars: ["detail"], secret: false, editable: false },
  ai_daily_cap: { label: "Yapay zekâ günlük maliyet sınırı aşıldı (SaaS sahibine)", vars: ["salon", "slug", "limitUsd"], secret: false, editable: false },
  // Müşteri adı/telefonu içerir: değişkenler e-posta kaydında saklanmaz (secret); yeniden deneme kuyruktan yapılır.
  booking_new_staff: { label: "Yeni online randevu (işletme yetkililerine)", vars: ["salon", "customer", "service", "when"], secret: true, editable: false },
  booking_cancelled_staff: { label: "Müşteri randevuyu iptal etti (işletme yetkililerine)", vars: ["salon", "customer", "service", "when"], secret: true, editable: false },
  booking_confirmation_customer: { label: "Online randevu onayı ve iptal bağlantısı (salon müşterisine)", vars: ["salon", "firstName", "service", "when"], secret: true, editable: false },
  booking_confirmed_customer: { label: "Salon randevuyu onayladı (salon müşterisine)", vars: ["salon", "firstName", "service", "when"], secret: true, editable: false },
  booking_rescheduled_customer: { label: "Salon randevu saatini değiştirdi (salon müşterisine)", vars: ["salon", "firstName", "service", "when", "previousWhen"], secret: true, editable: false },
  booking_declined_customer: { label: "Salon randevuyu iptal etti / reddetti (salon müşterisine)", vars: ["salon", "firstName", "service", "when"], secret: true, editable: false },
};

export interface TemplateOverride {
  subject: string;
  body: string;
}

function layout(title: string, paragraphs: string[], cta?: { label: string; link: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join("");
  const button = cta
    ? `<p style="margin:22px 0"><a href="${esc(cta.link)}" style="background:#933c63;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">${esc(cta.label)}</a></p><p style="font-size:12px;color:#777">Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:<br>${esc(cta.link)}</p>`
    : "";
  return `<!doctype html><html lang="tr"><body style="font-family:Arial,sans-serif;background:#faf8f5;color:#231a1f;padding:24px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e6dfd5"><h2 style="margin-top:0;color:#4a2535">${esc(title)}</h2>${body}${button}<p style="font-size:12px;color:#999;margin-top:28px">ProGüzellik · Bu e-posta otomatik gönderilmiştir.</p></div></body></html>`;
}

const fill = (tpl: string, vars: Record<string, unknown>, escape: boolean) =>
  // Değeri olmayan (isteğe bağlı) değişken boş bırakılır; e-postada "{payTo}" gibi ham yer tutucu görünmez.
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => (vars[k] !== undefined && vars[k] !== null ? (escape ? esc(String(vars[k])) : String(vars[k])) : ""));

/** Türkçe e-posta şablonları (HTML + düz metin). Değişkenler HTML'e kaçışlanarak eklenir. */
export function render(t: EmailTemplate, override?: TemplateOverride | null): { subject: string; html: string; text: string; body: string } {
  let subject: string;
  let paras: string[];
  let cta: { label: string; link: string } | undefined;
  switch (t.name) {
    case "password_reset":
      subject = "Parola sıfırlama";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, `Parolanızı sıfırlamak için aşağıdaki bağlantıyı ${t.vars.minutes} dakika içinde kullanın.`, "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; parolanız değişmez."];
      cta = { label: "Parolamı sıfırla", link: t.vars.link };
      break;
    case "password_changed":
      subject = "Parolanız değiştirildi";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, "Hesabınızın parolası değiştirildi ve tüm açık oturumlar kapatıldı.", "Bu işlemi siz yapmadıysanız hemen işletme yöneticinizle veya destek ekibimizle iletişime geçin."];
      break;
    case "email_verify":
      subject = "E-posta adresinizi doğrulayın";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, "ProGüzellik hesabınızı güvenle kullanabilmek için e-posta adresinizi doğrulayın."];
      cta = { label: "E-postamı doğrula", link: t.vars.link };
      break;
    case "trial_verify":
      subject = "Ücretsiz denemenizi başlatmak için e-postanızı doğrulayın";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, `${esc(t.vars.salon)} için ProGüzellik ücretsiz deneme başvurunuzu aldık. Hesabınız ve 7 günlük deneme süreniz e-posta adresinizi doğruladığınızda başlar.`, `Bağlantı ${t.vars.hours} saat geçerlidir ve bir kez kullanılabilir. Bu başvuruyu siz yapmadıysanız e-postayı dikkate almayın; hesap açılmaz.`];
      cta = { label: "E-postamı doğrula ve denemeyi başlat", link: t.vars.link };
      break;
    case "trial_application_verify":
      subject = "Deneme başvurunuz için e-postanızı doğrulayın";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, `${esc(t.vars.salon)} için ProGüzellik ücretsiz deneme başvurunuzu aldık. Başvurunuz e-posta adresinizi doğruladığınızda ekibimize iletilir; onaylandığında hesabınızı oluşturmanız için ayrı bir davet e-postası alırsınız.`, `Bağlantı ${t.vars.hours} saat geçerlidir ve bir kez kullanılabilir. Bu başvuruyu siz yapmadıysanız e-postayı dikkate almayın; başvuru iletilmez.`];
      cta = { label: "E-postamı doğrula", link: t.vars.link };
      break;
    case "trial_application_received":
      subject = `Yeni deneme başvurusu: ${t.vars.salon}`;
      paras = [`${esc(t.vars.salon)} için yeni bir ücretsiz deneme başvurusu geldi ve başvuran e-posta adresini doğruladı.`, "Başvuru, bilgileri doldurulmuş olarak SaaS yönetim panelinde onayınızı bekliyor."];
      cta = { label: "Başvuruyu incele", link: t.vars.link };
      break;
    case "signup_exists":
      subject = "ProGüzellik hesabınız zaten var";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, "Bu e-posta adresiyle yeni bir ücretsiz deneme başvurusu yapıldı; ancak adına kayıtlı bir hesap zaten var. Yeni hesap açılmadı.", "Parolanızı hatırlamıyorsanız giriş sayfasındaki “Parolamı unuttum” bağlantısını kullanın. Bu başvuruyu siz yapmadıysanız bir işlem yapmanız gerekmez."];
      cta = { label: "Giriş yap", link: t.vars.link };
      break;
    case "purchase_verify":
      subject = "Paket satın alımınız için e-postanızı doğrulayın";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, `${esc(t.vars.salon)} için ProGüzellik ${esc(t.vars.plan)} paketi satın alma isteğinizi aldık. Ödeme adımına geçmek için e-posta adresinizi doğrulayın.`, "Hesabınız yalnız ödemeniz başarıyla alındığında açılır; ödeme yapılmazsa hesap açılmaz.", `Bağlantı ${t.vars.hours} saat geçerlidir. Bu isteği siz yapmadıysanız e-postayı dikkate almayın.`];
      cta = { label: "E-postamı doğrula ve ödemeye geç", link: t.vars.link };
      break;
    case "purchase_exists":
      subject = "ProGüzellik hesabınız zaten var";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, "Bu e-posta adresiyle sitemizden yeni bir paket satın alma isteği yapıldı; ancak adına kayıtlı bir hesap zaten var. Yeni hesap açılmadı ve ödeme alınmadı.", "Paketinizi hesabınıza giriş yaparak Abonelik sayfasından satın alabilirsiniz. Parolanızı hatırlamıyorsanız giriş sayfasındaki “Parolamı unuttum” bağlantısını kullanın."];
      cta = { label: "Giriş yap", link: t.vars.link };
      break;
    case "purchase_completed":
      subject = "Ödemeniz alındı, ProGüzellik hesabınız açıldı";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, `${esc(t.vars.salon)} için ${esc(t.vars.plan)} paketi ödemeniz (${esc(t.vars.amount)} TL, KDV dahil) alındı ve hesabınız açıldı. Dönem sonu: ${esc(t.vars.until)}.`, "Satın alırken belirlediğiniz e-posta ve parolayla giriş yapabilirsiniz. Abonelik her dönem aynı karttan otomatik yenilenir; Abonelik sayfasından istediğiniz zaman iptal edebilirsiniz."];
      cta = { label: "Giriş yap", link: t.vars.link };
      break;
    case "purchase_received":
      subject = `Yeni paket satışı: ${t.vars.salon}`;
      paras = [`${esc(t.vars.salon)} siteden ${esc(t.vars.plan)} paketini satın aldı (${esc(t.vars.amount)} TL, KDV dahil). İşletme ve sahip hesabı otomatik açıldı.`, "Faturayı düzenlemeyi unutmayın (e-Fatura entegrasyonu henüz yok)."];
      cta = { label: "İşletmeyi görüntüle", link: t.vars.link };
      break;
    case "tenant_invite":
      subject = `${t.vars.salon} – ProGüzellik davetiniz`;
      paras = [`Merhaba ${esc(t.vars.fullName)},`, t.vars.role ? `${esc(t.vars.salon)} işletmesine ${esc(t.vars.role)} olarak ProGüzellik'e davet edildiniz.` : `${esc(t.vars.salon)} işletmesinin yöneticisi olarak ProGüzellik'e davet edildiniz.`, `Hesabınızı oluşturmak için aşağıdaki bağlantıyı ${t.vars.days} gün içinde kullanın. Bağlantı yalnızca bir kez çalışır.`, "Bu daveti beklemiyorsanız e-postayı yok sayabilirsiniz."];
      cta = { label: "Daveti kabul et", link: t.vars.link };
      break;
    case "mfa_enabled":
      subject = "İki adımlı doğrulama açıldı";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, "Hesabınızda iki adımlı doğrulama etkinleştirildi. Kurtarma kodlarınızı güvenli bir yerde saklayın."];
      break;
    case "mfa_reset":
      subject = "İki adımlı doğrulamanız sıfırlandı";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, "ProGüzellik destek ekibi talebiniz üzerine hesabınızdaki iki adımlı doğrulamayı sıfırladı ve açık oturumlarınızı kapattı.", "Bir sonraki girişinizde iki adımlı doğrulamayı yeniden kurmanızı öneririz. Bu işlemi siz talep etmediyseniz hemen bizimle iletişime geçin."];
      break;
    case "customer_otp":
      subject = `${t.vars.salon} doğrulama kodunuz`; // Kod konuya yazılmaz: konu e-posta kaydında saklanır.
      paras = [
        `${esc(t.vars.salon)} online randevu sayfası için doğrulama kodunuz:`,
        `<b style="font-size:24px;letter-spacing:4px">${esc(t.vars.code)}</b>`,
        `Kod ${t.vars.minutes} dakika geçerlidir ve bir kez kullanılabilir. Bu isteği siz yapmadıysanız e-postayı dikkate almayın; kimse hesabınıza erişemez.`,
      ];
      break;
    case "trial_ending":
      subject = `Deneme sürenizin bitmesine ${t.vars.days} gün kaldı`;
      paras = [`${esc(t.vars.salon)} için deneme süreniz ${t.vars.days} gün içinde sona erecek.`, "Kesintisiz devam etmek için bir paket seçin."];
      cta = { label: "Paket seç", link: t.vars.link };
      break;
    case "trial_ended":
      subject = "Deneme süreniz sona erdi";
      paras = [`${esc(t.vars.salon)} için deneme süreniz sona erdi. Verileriniz korunuyor; paket seçene kadar panel salt okunur çalışır.`];
      cta = { label: "Paket seç", link: t.vars.link };
      break;
    case "payment_failed":
      subject = "Abonelik ödemesi alınamadı";
      paras = [`${esc(t.vars.salon)} aboneliğinin yenileme ödemesi alınamadı.`, `${t.vars.graceDays} gün içinde ödeme yapılmazsa abonelik sona erer. Bu süre boyunca panel salt okunur çalışır.`];
      cta = { label: "Ödeme yap", link: t.vars.link };
      break;
    case "subscription_renewed":
      subject = "Aboneliğiniz yenilendi";
      paras = [`${esc(t.vars.salon)} – ${esc(t.vars.plan)} paketi yenilendi.`, `Tahsil edilen tutar: ${esc(t.vars.amount)} TL. Yeni dönem sonu: ${esc(t.vars.until)}.`];
      break;
    case "subscription_cancelled":
      subject = "Aboneliğiniz sona erdi";
      paras = [`${esc(t.vars.salon)} aboneliği sona erdi. Verileriniz saklanıyor; yeniden paket seçerek kaldığınız yerden devam edebilirsiniz.`];
      cta = { label: "Paket seç", link: t.vars.link };
      break;
    case "subscription_expired":
      subject = "Abonelik süreniz doldu";
      paras = [`${esc(t.vars.salon)} için tanımlı abonelik süresi doldu. Verileriniz korunuyor.`, `${t.vars.graceDays} gün içinde yenilenmezse abonelik sona erer. Yenileme için bizimle iletişime geçin.`];
      cta = { label: "Abonelik durumu", link: t.vars.link };
      break;
    case "plan_limit_exceeded":
      subject = "Paket personel sınırı aşıldı";
      paras = [`${esc(t.vars.salon)} işletmesinde ${t.vars.active} aktif personel var; mevcut paket en fazla ${t.vars.max} personele izin veriyor.`, "Yeni personel eklenemez. Paketinizi yükseltin veya bazı personeli pasife alın."];
      cta = { label: "Aboneliği yönet", link: t.vars.link };
      break;
    case "subscription_started":
      subject = "Aboneliğiniz başladı";
      paras = [`${esc(t.vars.salon)} için ${esc(t.vars.plan)} paketi tanımlandı. Dönem sonu: ${esc(t.vars.until)}.`, ...(t.vars.complimentary ? ["Bu abonelik ücretsiz olarak tanımlanmıştır; sizden ödeme alınmayacaktır."] : [])];
      cta = { label: "Abonelik durumu", link: t.vars.link };
      break;
    case "payment_reminder":
      subject = "Ödeme hatırlatması";
      paras = [`${esc(t.vars.salon)} için vadesi ${esc(t.vars.dueDate)} olan "${esc(t.vars.description)}" kaleminde ${esc(t.vars.amount)} TL ödemeniz bekleniyor.`, ...(t.vars.payTo ? [`Ödeme bilgileri: ${esc(t.vars.payTo)}`] : []), "Ödemeyi yaptıysanız bu e-postayı dikkate almayın."];
      break;
    case "invoice_notice":
      subject = `Faturanız: ${t.vars.number}`;
      paras = [`${esc(t.vars.salon)} adına ${esc(t.vars.date)} tarihli ${esc(t.vars.number)} numaralı faturanız düzenlendi.`, `Tutar: ${esc(t.vars.amount)} TL.`];
      break;
    case "low_stock_alert":
      subject = `${t.vars.salon}: ${t.vars.count} ürün kritik stok seviyesinde`;
      paras = [
        `${esc(t.vars.salon)} işletmesinde aşağıdaki ürünler kritik seviyede ya da altında:`,
        String(t.vars.items ?? "").split("\n").filter(Boolean).map((i) => `• ${esc(i)}`).join("<br>"),
        "Bu uyarıyı Ayarlar sayfasından kapatabilirsiniz.",
      ];
      cta = { label: "Stoğa git", link: t.vars.link };
      break;
    case "renewal_reminder":
      subject = `${t.vars.salon}: ${t.vars.service} yenileme zamanınız yaklaşıyor`;
      paras = [
        `Merhaba ${esc(t.vars.firstName)},`,
        `${esc(t.vars.service)} işleminizin yenileme zamanı ${esc(t.vars.dueDate)} civarında. Size uygun bir saat için şimdiden randevu alabilirsiniz.`,
        ...(t.vars.phone ? [`Randevu için ${esc(t.vars.salon)}: ${esc(t.vars.phone)}`] : []),
        `<span style="font-size:12px;color:#777">Bu hatırlatmaları ${esc(t.vars.salon)} gönderiyor. Almak istemiyorsanız: <a href="${esc(t.vars.optOutLink)}">hatırlatmaları kapat</a> (${esc(t.vars.optOutLink)})</span>`,
      ];
      cta = { label: "Randevu al", link: t.vars.link };
      break;
    case "ai_quota_low":
      subject = `${t.vars.salon}: yapay zekâ kullanım hakkınız azaldı`;
      paras = [
        `Bu ayki yapay zekâ kullanım hakkınızın yaklaşık %20'si kaldı.`,
        `Hak bittiğinde yapay zekâ yeni mesajlara yanıt vermez; mesajlar ekibinize düşer. Hakkınız her ay yenilenir${t.vars.canBuy ? "; isterseniz panelden ek paket alabilirsiniz" : ""}.`,
      ];
      cta = { label: "Kullanım durumunu gör", link: t.vars.link };
      break;
    case "ai_quota_empty":
      subject = `${t.vars.salon}: yapay zekâ kullanım hakkınız doldu`;
      paras = [
        `Bu ayki yapay zekâ kullanım hakkınız doldu. Yeni mesajlar artık ekibinize düşüyor; müşterilerinize sizin yanıt vermeniz gerekiyor.`,
        t.vars.canBuy ? `Hakkınız bir sonraki dönemde kendiliğinden yenilenir. Beklemek istemezseniz panelden ek paket alabilirsiniz.` : `Hakkınız bir sonraki dönemde kendiliğinden yenilenir.`,
      ];
      cta = { label: t.vars.canBuy ? "Ek paket al" : "Kullanım durumunu gör", link: t.vars.link };
      break;
    case "ai_credit_purchased":
      subject = `${t.vars.salon}: yapay zekâ ek paketiniz yüklendi`;
      paras = [
        `${esc(t.vars.amount)} tutarındaki yapay zekâ ek paketiniz hesabınıza yüklendi. Kullanım barınızı panelden görebilirsiniz.`,
      ];
      cta = { label: "Kullanım durumunu gör", link: t.vars.link };
      break;
    case "ai_fx_stale":
      subject = "Yapay zekâ: dolar kuru otomatik güncellenemedi";
      paras = [
        "Yapay zekâ kullanım hesabındaki dolar kuru TCMB döviz satış kurundan otomatik güncellenemedi. Son geçerli kur kullanılmaya devam ediyor.",
        esc(t.vars.detail),
        "Gerekirse SaaS sahibi panelindeki Yapay zekâ sayfasından kuru elle girin ya da Şimdi güncelle ile yeniden deneyin.",
      ];
      cta = { label: "Yapay zekâ sayfasını aç", link: t.vars.link };
      break;
    case "ai_daily_cap":
      subject = `Yapay zekâ günlük sınırı: ${t.vars.salon}`;
      paras = [
        `${esc(t.vars.salon)} (${esc(t.vars.slug)}) bugün yapay zekâ için günlük gerçek maliyet sınırına (${esc(t.vars.limitUsd)} USD) ulaştı.`,
        `Gün sonuna kadar bu işletmede gelen mesajlar yapay zekâ yerine ekibe yönlendiriliyor. Sınır olağan dışı bir kullanımı gösteriyor olabilir; konuşmaları kontrol edin. Sınırı SaaS sahibi panelindeki Yapay zekâ sayfasından değiştirebilirsiniz.`,
      ];
      cta = { label: "Yapay zekâ sayfasını aç", link: t.vars.link };
      break;
    case "booking_new_staff":
      subject = `Yeni online randevu: ${t.vars.when}`;
      paras = [
        `${esc(t.vars.salon)} için ${esc(t.vars.source)} yeni bir randevu alındı.`,
        [
          `<b>Müşteri:</b> ${esc(t.vars.customer)}`,
          ...(t.vars.phone ? [`<b>Telefon:</b> ${esc(t.vars.phone)}`] : []),
          `<b>Hizmet:</b> ${esc(t.vars.service)}`,
          `<b>Uzman:</b> ${esc(t.vars.staff)}`,
          `<b>Tarih:</b> ${esc(t.vars.when)}`,
        ].join("<br>"),
        ...(t.vars.notes ? [`<b>Not:</b> ${esc(t.vars.notes).replace(/\n/g, "<br>")}`] : []),
        "Randevu takviminizde “Bekliyor” durumunda görünür. Müşteriyi arayarak teyit edebilir ve randevuyu onaylayabilirsiniz.",
        `<span style="font-size:12px;color:#777">Bu e-postaları panelde Bildirim merkezi sayfasındaki “Yeni randevular” tercihinden kapatabilirsiniz.</span>`,
      ];
      cta = { label: "Randevuyu panelde gör", link: t.vars.link };
      break;
    case "booking_cancelled_staff":
      subject = `Müşteri randevuyu iptal etti: ${t.vars.when}`;
      paras = [
        `${esc(t.vars.customer)}${t.vars.phone ? ` (${esc(t.vars.phone)})` : ""}, ${esc(t.vars.salon)} için aldığı randevuyu iptal etti.`,
        [`<b>Hizmet:</b> ${esc(t.vars.service)}`, `<b>Uzman:</b> ${esc(t.vars.staff)}`, `<b>Tarih:</b> ${esc(t.vars.when)}`].join("<br>"),
        "Saat takviminizde yeniden boşa çıktı.",
      ];
      cta = { label: "Takvimi aç", link: t.vars.link };
      break;
    case "booking_confirmation_customer":
      subject = `${t.vars.salon}: randevunuz alındı (${t.vars.when})`;
      paras = [
        `Merhaba ${esc(t.vars.firstName)},`,
        `${esc(t.vars.salon)} için randevunuz alındı.`,
        [`<b>Hizmet:</b> ${esc(t.vars.service)}`, `<b>Uzman:</b> ${esc(t.vars.staff)}`, `<b>Tarih:</b> ${esc(t.vars.when)}`, ...(t.vars.address ? [`<b>Adres:</b> ${esc(t.vars.address)}`] : [])].join("<br>"),
        `Randevunuzu en geç ${t.vars.cancelHours} saat öncesine kadar aşağıdaki bağlantıdan iptal edebilirsiniz. Bu e-postayı saklayın; bağlantı yalnızca bu randevu içindir.`,
        ...(t.vars.phone ? [`Değişiklik ve sorularınız için ${esc(t.vars.salon)}: ${esc(t.vars.phone)}`] : []),
      ];
      cta = { label: "Randevuyu görüntüle / iptal et", link: t.vars.cancelLink };
      break;
    case "booking_confirmed_customer":
      subject = `${t.vars.salon}: randevunuz onaylandı (${t.vars.when})`;
      paras = [
        `Merhaba ${esc(t.vars.firstName)},`,
        `${esc(t.vars.salon)} randevunuzu onayladı. Sizi bekliyoruz.`,
        [`<b>Hizmet:</b> ${esc(t.vars.service)}`, `<b>Uzman:</b> ${esc(t.vars.staff)}`, `<b>Tarih:</b> ${esc(t.vars.when)}`, ...(t.vars.address ? [`<b>Adres:</b> ${esc(t.vars.address)}`] : [])].join("<br>"),
        `Gelemeyecekseniz randevunuzu en geç ${t.vars.cancelHours} saat öncesine kadar aşağıdaki bağlantıdan iptal edebilirsiniz.`,
        ...(t.vars.phone ? [`Değişiklik ve sorularınız için ${esc(t.vars.salon)}: ${esc(t.vars.phone)}`] : []),
      ];
      cta = { label: "Randevuyu görüntüle / iptal et", link: t.vars.cancelLink };
      break;
    case "booking_rescheduled_customer":
      subject = `${t.vars.salon}: randevu saatiniz değişti (${t.vars.when})`;
      paras = [
        `Merhaba ${esc(t.vars.firstName)},`,
        `${esc(t.vars.salon)} randevunuz için yeni bir saat belirledi.`,
        [`<b>Yeni tarih:</b> ${esc(t.vars.when)}`, `<b>Önceki tarih:</b> ${esc(t.vars.previousWhen)}`, `<b>Hizmet:</b> ${esc(t.vars.service)}`, `<b>Uzman:</b> ${esc(t.vars.staff)}`].join("<br>"),
        `Yeni saat size uymuyorsa ${t.vars.phone ? `${esc(t.vars.salon)} ile ${esc(t.vars.phone)} numarasından görüşebilir ya da ` : ""}randevunuzu en geç ${t.vars.cancelHours} saat öncesine kadar aşağıdaki bağlantıdan iptal edebilirsiniz.`,
      ];
      cta = { label: "Randevuyu görüntüle / iptal et", link: t.vars.cancelLink };
      break;
    case "booking_declined_customer":
      subject = `${t.vars.salon}: randevunuz iptal edildi (${t.vars.when})`;
      paras = [
        `Merhaba ${esc(t.vars.firstName)},`,
        `${esc(t.vars.salon)}, ${esc(t.vars.when)} tarihli ${esc(t.vars.service)} randevunuzu gerçekleştiremeyeceğini bildirdi ve randevuyu iptal etti.`,
        ...(t.vars.reason ? [`<b>Açıklama:</b> ${esc(t.vars.reason)}`] : []),
        `Size uygun başka bir saat için aşağıdaki bağlantıdan yeniden randevu alabilirsiniz.${t.vars.phone ? ` Sorularınız için ${esc(t.vars.salon)}: ${esc(t.vars.phone)}` : ""}`,
      ];
      cta = { label: "Yeni randevu al", link: t.vars.bookLink };
      break;
    case "owner_notice":
      subject = t.vars.subject;
      paras = t.vars.body.split(/\n\s*\n/).map((p) => esc(p.trim()).replace(/\n/g, "<br>")).filter(Boolean);
      break;
  }
  if (override && TEMPLATE_META[t.name].editable) {
    const vars = t.vars as Record<string, unknown>;
    subject = fill(override.subject, vars, false);
    paras = override.body.split(/\n\s*\n/).map((p) => fill(esc(p.trim()), vars, true).replace(/\n/g, "<br>")).filter(Boolean);
  }
  const html = layout(subject, paras, cta);
  const plain = paras.map((p) => p.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  const text = [subject, "", ...plain, ...(cta ? ["", `${cta.label}: ${cta.link}`] : [])].join("\n");
  /** Düzenlenebilir gövde: yalnızca paragraflar (konu ve bağlantı düğmesi hariç) */
  const body = plain.join("\n\n");
  return { subject, html, text, body };
}
