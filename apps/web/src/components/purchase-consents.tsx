import { LEGAL_EMAIL, LEGAL_MERSIS, LEGAL_PROVIDER } from "@/content/legal/meta";
import { tl } from "@/lib/format";

/** Ödeme sayfalarında (siteden satın alma ve panel) iyzico formundan önce gösterilen Ön Bilgilendirme özeti ve zorunlu onaylar. */
export function PreInfoSummary(p: { planName: string; maxStaff: number; cycle: "MONTHLY" | "YEARLY"; net: string; vatRate: string | number; gross: string }) {
  const yearly = p.cycle === "YEARLY";
  const renew = new Date();
  if (yearly) renew.setFullYear(renew.getFullYear() + 1);
  else renew.setMonth(renew.getMonth() + 1);
  return (
    <details className="rounded-xl border border-sand-200 bg-white p-4 text-sm" data-testid="pre-info" open>
      <summary className="cursor-pointer font-semibold">Ön Bilgilendirme Formu (özet)</summary>
      <dl className="mt-3 space-y-2">
        <div><dt className="font-medium">Satıcı</dt><dd>{LEGAL_PROVIDER}, MERSİS {LEGAL_MERSIS}, {LEGAL_EMAIL}. Adres ve vergi bilgileri formun tam metnindeki künyededir.</dd></div>
        <div><dt className="font-medium">Alıcı</dt><dd>Bu sayfada beyan ettiğiniz fatura bilgileri.</dd></div>
        <div><dt className="font-medium">Hizmet</dt><dd>Pro Güzellik {p.planName} paketi (en fazla {p.maxStaff} aktif personel), salon yönetim yazılımının abonelik süresince kullanım hakkı.</dd></div>
        <div><dt className="font-medium">Bedel</dt><dd>{tl(p.net)} + %{Number(p.vatRate).toLocaleString("tr-TR")} KDV = <b>{tl(p.gross)}</b> / {yearly ? "yıl" : "ay"}. Başka ücret yoktur.</dd></div>
        <div><dt className="font-medium">Ödeme ve yenileme</dt><dd>Kartla, iyzico aracılığıyla peşin. İptal edilmedikçe her {yearly ? "yıl" : "ay"} aynı karttan aynı tutarla otomatik yenilenir; ilk yenileme {renew.toLocaleDateString("tr-TR")}.</dd></div>
        <div><dt className="font-medium">İfa</dt><dd>Hizmet ödeme onaylanınca hemen kullanıma açılır.</dd></div>
        <div><dt className="font-medium">İptal ve iade</dt><dd>Panelden istediğiniz zaman iptal edebilirsiniz; erişim dönem sonuna kadar sürer. {yearly ? "Yıllık dönem başladıktan sonraki 14 gün içinde iptal ederseniz ödediğiniz bedelin tamamı iade edilir; sonrasında iade yapılmaz." : "Aylık aboneliklerde kullanılmayan günler için iade yapılmaz."}</dd></div>
        <div><dt className="font-medium">Cayma hakkı</dt><dd>Hizmet anında ifa edildiğinden, aşağıda hemen başlamasına onay verdiğinizde cayma hakkı kullanılamaz.</dd></div>
      </dl>
      <p className="mt-3"><a className="underline" href="/on-bilgilendirme-formu" target="_blank">Ön Bilgilendirme Formu&apos;nun tam metni</a></p>
    </details>
  );
}

/** Üç ayrı ve zorunlu onay kutusu. Adlar: onay, yenileme, aninda_ifa. */
export function PurchaseConsents({ cycle, gross }: { cycle: "MONTHLY" | "YEARLY"; gross: string }) {
  return (
    <div className="space-y-2 text-sm">
      <label className="flex items-start gap-2">
        <input type="checkbox" name="onay" className="mt-1" />
        <span>
          <a className="underline" href="/on-bilgilendirme-formu" target="_blank">Ön Bilgilendirme Formu</a>&apos;nu,{" "}
          <a className="underline" href="/mesafeli-satis-sozlesmesi" target="_blank">Mesafeli Satış Sözleşmesi</a>&apos;ni ve{" "}
          <a className="underline" href="/teslimat-ve-iade-sartlari" target="_blank">Teslimat ve İade Şartları</a>&apos;nı okudum, onaylıyorum.
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="yenileme" className="mt-1" />
        <span>Aboneliğimin iptal edene kadar her {cycle === "YEARLY" ? "yıl" : "ay"} sonunda aynı karttan {tl(gross)} olarak otomatik yenilenmesine onay veriyorum.</span>
      </label>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="aninda_ifa" className="mt-1" />
        <span>Hizmetin hemen başlamasını istiyorum; hizmet anında ifa edildiği için cayma hakkımın bulunmadığını biliyorum.</span>
      </label>
      <p className="text-xs text-neutral-500">Kişisel verilerinizin işlenmesi: <a className="underline" href="/kvkk" target="_blank">KVKK Aydınlatma Metni</a>.</p>
    </div>
  );
}

/** Eksik onay varsa kullanıcıya gösterilecek hata, yoksa null. */
export function consentError(f: FormData): string | null {
  if (!f.get("onay")) return "Devam etmek için Ön Bilgilendirme Formu'nu ve sözleşmeleri onaylayın";
  if (!f.get("yenileme")) return "Devam etmek için otomatik yenilemeye onay verin";
  if (!f.get("aninda_ifa")) return "Devam etmek için hizmetin hemen başlamasına onay verin";
  return null;
}

/** API'ye gönderilen onay alanları. */
export const CONSENT_FIELDS = { acceptedTerms: true, acceptedRenewal: true, acceptedInstantPerformance: true } as const;
