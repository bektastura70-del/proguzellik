import { LegalPage } from "@/components/legal";
import { getSiteInfo } from "@/lib/site";

/** Şirket unvanı ve iletişim bilgisi SaaS sahibi panelindeki "Şirket ayarları"ndan gelir (metinde elle yazılmaz). */
export const dynamic = "force-dynamic";
export const metadata = { title: "Kullanım Koşulları", alternates: { canonical: "/kullanim-kosullari" } };

/** Şablon: ürünün gerçek işleyişini anlatır; şirket/hukuk bilgileri [KÖŞELİ PARANTEZ] ile işaretlidir ve doldurulmalıdır. */
export default async function Terms() {
  const { company } = await getSiteInfo();
  return (
    <LegalPage title="Kullanım Koşulları">
      <p>Bu koşullar, {company.legalName ?? "[ŞİRKET ÜNVANI]"} (&quot;ProGüzellik&quot;) tarafından sunulan ProGüzellik salon yönetim yazılımının (&quot;Hizmet&quot;) kullanımını düzenler. Hizmete kaydolarak bu koşulları kabul etmiş olursunuz.</p>
      <h2>1. Hesap ve işletme</h2>
      <ul>
        <li>Hesap, e-posta adresinin doğrulanmasıyla açılır. Hesap bilgilerinin doğru tutulmasından ve parolanın korunmasından hesap sahibi sorumludur.</li>
        <li>İşletme sahibi, ekibine verdiği yetkilerden ve ekibinin Hizmet üzerindeki işlemlerinden sorumludur.</li>
      </ul>
      <h2>2. Ücretsiz deneme</h2>
      <ul>
        <li>Yeni işletmeler için 14 günlük ücretsiz deneme süresi, e-posta doğrulamasıyla başlar. Deneme için ödeme bilgisi istenmez.</li>
        <li>Deneme süresi sona erdiğinde hesap salt okunur hâle gelir; veriler silinmez. Kullanıma devam etmek için ücretli bir paket tanımlanması gerekir.</li>
        <li>Aynı işletme veya kişi için birden fazla deneme hesabı açılması kötüye kullanım sayılır ve hesaplar sınırlandırılabilir.</li>
      </ul>
      <h2>3. Ücretler ve ödeme</h2>
      <p>Paket ücretleri, vergiler ve ödeme koşulları [FİYATLANDIRMA VE ÖDEME KOŞULLARI] bölümünde belirtilir. Fatura bilgileri [FATURALANDIRMA BİLGİSİ].</p>
      <h2>4. Veriler</h2>
      <ul>
        <li>İşletmenin Hizmete girdiği müşteri, randevu ve mali kayıtlar işletmeye aittir; işletme bu veriler bakımından veri sorumlusudur, ProGüzellik veri işleyen sıfatıyla hareket eder. Ayrıntılar <a href="/kvkk">KVKK Aydınlatma Metni</a> ve <a href="/gizlilik">Gizlilik Politikası</a>&apos;ndadır.</li>
        <li>İşletme, müşterilerinden gerekli aydınlatma ve onayları almakla yükümlüdür.</li>
      </ul>
      <h2>5. Kabul edilemez kullanım</h2>
      <p>Hizmet; yasalara aykırı içerik, izinsiz ticari ileti gönderimi, başka kullanıcıların verilerine erişim girişimi veya Hizmetin işleyişini bozacak faaliyetler için kullanılamaz.</p>
      <h2>6. Hesabın askıya alınması ve sona erme</h2>
      <p>Bu koşulların ihlali veya ödeme yapılmaması hâlinde hesap askıya alınabilir. Hesabın kapatılması ve verilerin teslimi/silinmesi [SÜRE VE USUL].</p>
      <h2>7. Sorumluluk</h2>
      <p>[SORUMLULUK SINIRLARI]</p>
      <h2>8. Değişiklikler ve iletişim</h2>
      <p>Koşullardaki değişiklikler yürürlükten önce hesap e-postasına bildirilir. Sorularınız için: info@proguzellik.com. Uyuşmazlıklarda [YETKİLİ MAHKEME/İCRA DAİRELERİ].</p>
    </LegalPage>
  );
}
