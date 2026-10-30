const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type EmailTemplate =
  | { name: "password_reset"; vars: { fullName: string; link: string; minutes: number } }
  | { name: "password_changed"; vars: { fullName: string } }
  | { name: "email_verify"; vars: { fullName: string; link: string } }
  | { name: "trial_verify"; vars: { fullName: string; salon: string; link: string; hours: number } }
  | { name: "signup_exists"; vars: { fullName: string; link: string } }
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
  | { name: "owner_notice"; vars: { subject: string; body: string; salon?: string } };

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
  signup_exists: { label: "Kayıt denemesi: hesap zaten var", vars: ["fullName"], secret: false, editable: false },
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
      paras = [`Merhaba ${esc(t.vars.fullName)},`, `${esc(t.vars.salon)} için ProGüzellik ücretsiz deneme başvurunuzu aldık. Hesabınız ve 14 günlük deneme süreniz e-posta adresinizi doğruladığınızda başlar.`, `Bağlantı ${t.vars.hours} saat geçerlidir ve bir kez kullanılabilir. Bu başvuruyu siz yapmadıysanız e-postayı dikkate almayın; hesap açılmaz.`];
      cta = { label: "E-postamı doğrula ve denemeyi başlat", link: t.vars.link };
      break;
    case "signup_exists":
      subject = "ProGüzellik hesabınız zaten var";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, "Bu e-posta adresiyle yeni bir ücretsiz deneme başvurusu yapıldı; ancak adına kayıtlı bir hesap zaten var. Yeni hesap açılmadı.", "Parolanızı hatırlamıyorsanız giriş sayfasındaki “Parolamı unuttum” bağlantısını kullanın. Bu başvuruyu siz yapmadıysanız bir işlem yapmanız gerekmez."];
      cta = { label: "Giriş yap", link: t.vars.link };
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
