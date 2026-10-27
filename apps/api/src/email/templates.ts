const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type EmailTemplate =
  | { name: "password_reset"; vars: { fullName: string; link: string; minutes: number } }
  | { name: "password_changed"; vars: { fullName: string } }
  | { name: "email_verify"; vars: { fullName: string; link: string } }
  | { name: "mfa_enabled"; vars: { fullName: string } }
  | { name: "trial_ending"; vars: { salon: string; days: number; link: string } }
  | { name: "trial_ended"; vars: { salon: string; link: string } }
  | { name: "payment_failed"; vars: { salon: string; graceDays: number; link: string } }
  | { name: "subscription_renewed"; vars: { salon: string; plan: string; amount: string; until: string } }
  | { name: "subscription_cancelled"; vars: { salon: string; link: string } }
  | { name: "plan_limit_exceeded"; vars: { salon: string; active: number; max: number; link: string } };

function layout(title: string, paragraphs: string[], cta?: { label: string; link: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join("");
  const button = cta
    ? `<p style="margin:22px 0"><a href="${esc(cta.link)}" style="background:#933c63;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">${esc(cta.label)}</a></p><p style="font-size:12px;color:#777">Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:<br>${esc(cta.link)}</p>`
    : "";
  return `<!doctype html><html lang="tr"><body style="font-family:Arial,sans-serif;background:#faf8f5;color:#231a1f;padding:24px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e6dfd5"><h2 style="margin-top:0;color:#4a2535">${esc(title)}</h2>${body}${button}<p style="font-size:12px;color:#999;margin-top:28px">ProGüzellik · Bu e-posta otomatik gönderilmiştir.</p></div></body></html>`;
}

/** Türkçe e-posta şablonları (HTML + düz metin). Değişkenler HTML'e kaçışlanarak eklenir. */
export function render(t: EmailTemplate): { subject: string; html: string; text: string } {
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
    case "mfa_enabled":
      subject = "İki adımlı doğrulama açıldı";
      paras = [`Merhaba ${esc(t.vars.fullName)},`, "Hesabınızda iki adımlı doğrulama etkinleştirildi. Kurtarma kodlarınızı güvenli bir yerde saklayın."];
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
    case "plan_limit_exceeded":
      subject = "Paket personel sınırı aşıldı";
      paras = [`${esc(t.vars.salon)} işletmesinde ${t.vars.active} aktif personel var; mevcut paket en fazla ${t.vars.max} personele izin veriyor.`, "Yeni personel eklenemez. Paketinizi yükseltin veya bazı personeli pasife alın."];
      cta = { label: "Aboneliği yönet", link: t.vars.link };
      break;
  }
  const html = layout(subject, paras, cta);
  const text = [subject, "", ...paras.map((p) => p.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")), ...(cta ? ["", `${cta.label}: ${cta.link}`] : [])].join("\n");
  return { subject, html, text };
}
