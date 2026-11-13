import Link from "next/link";
import { LegalImprint, LegalPage } from "@/components/legal";

/** Künye (adres, vergi bilgisi) Şirket ayarları'ndan her istekte okunur. */
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pro Güzellik uygulaması: hesap silme",
  description: "Pro Güzellik iOS ve Android uygulamasındaki müşteri hesabınızı nasıl silebileceğiniz.",
  alternates: { canonical: "/hesap-silme" },
};

/**
 * Mağaza şartı (Google Play "hesap silme bağlantısı", Apple 5.1.1(v)): uygulama dışından da erişilebilen hesap silme sayfası.
 * Bu sayfa işleyişi anlatır; hukuki metin değildir (bkz. Hesap kapatma ve veri silme politikası).
 */
export default function AccountDeletion() {
  return (
    <LegalPage title="Pro Güzellik uygulaması: hesap silme" imprint={<LegalImprint />}>
      <div className="space-y-6 text-[15px] leading-7 text-neutral-800">
        <p>
          Pro Güzellik uygulamasında (iOS ve Android) salonunuzdan randevu almak için açtığınız müşteri hesabını istediğiniz zaman
          kalıcı olarak silebilirsiniz. Hesap her salon için ayrıdır; birden fazla salonda hesabınız varsa her biri için ayrı silinir.
        </p>

        <section>
          <h2 className="font-display text-xl font-semibold">Uygulamadan silme</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-6">
            <li>Uygulamayı açın ve hesabınızın olduğu salonu seçin.</li>
            <li>Alttaki menüden <b>Hesabım</b>'a dokunun.</li>
            <li><b>Hesabımı sil</b> bölümünde <b>Hesabımı silmek istiyorum</b>'a, ardından <b>Onay kodu gönder</b>'e dokunun.</li>
            <li>E-postanıza gelen 6 haneli kodu girip <b>Hesabımı kalıcı olarak sil</b>'e dokunun.</li>
          </ol>
          <p className="mt-2">Aynı adımları salonunuzun web sayfasında (proguzellik.com/r/salonadi) tarayıcıdan da izleyebilirsiniz; uygulamayı yüklemeniz gerekmez.</p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Neler silinir, neler kalır?</h2>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li><b>Hemen silinir:</b> e-posta adresinizle giriş hesabınız, tüm cihazlardaki oturumlarınız, bildirim kayıtlarınız, uygulama tercihleriniz ve bekleyen doğrulama kodlarınız.</li>
            <li><b>Telefonunuzda:</b> uygulamanın planladığı randevu hatırlatmaları silinir. Uygulamayı kaldırdığınızda cihazdaki tüm uygulama verisi de silinir.</li>
            <li><b>Salonda kalır:</b> salonun sizin için tuttuğu müşteri kaydı ve randevu geçmişi salonun kendi kayıtlarıdır. Bu kayıtlar için veri sorumlusu salondur; silinmesini doğrudan salondan isteyebilirsiniz.</li>
            <li><b>Güvenlik kaydı:</b> hesabın silindiğine dair, e-posta adresinizi içermeyen bir işlem kaydı (tarih ve IP adresi) tutulur.</li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Uygulamaya erişemiyorsanız</h2>
          <p className="mt-2">
            Kayıtlı e-posta adresinizden <a className="text-brand-700 underline" href="mailto:info@proguzellik.com?subject=Hesap%20silme%20talebi">info@proguzellik.com</a> adresine
            salon adını belirterek yazın. Talebiniz, e-posta adresinin size ait olduğu doğrulandıktan sonra işleme alınır.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">İşletme (salon) hesapları</h2>
          <p className="mt-2">
            Salon sahibi ve personel hesaplarının kapatılması için <Link className="text-brand-700 underline" href="/hesap-kapatma-ve-veri-silme">Hesap kapatma ve veri silme</Link> sayfasına bakın.
          </p>
        </section>
      </div>
    </LegalPage>
  );
}
