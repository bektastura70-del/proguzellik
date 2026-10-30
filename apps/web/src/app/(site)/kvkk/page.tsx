import { LegalPage } from "@/components/legal";

export const metadata = { title: "KVKK Aydınlatma Metni" };

export default function Kvkk() {
  return (
    <LegalPage title="KVKK Aydınlatma Metni">
      <p>6698 sayılı Kişisel Verilerin Korunması Kanunu (&quot;KVKK&quot;) uyarınca, [VERİ SORUMLUSU ÜNVANI] (&quot;ProGüzellik&quot;) olarak kişisel verilerinizi aşağıda açıklanan kapsamda işlemekteyiz.</p>
      <h2>1. İşlenen kişisel veriler</h2>
      <ul>
        <li>Kimlik ve iletişim: ad, soyad, telefon, e-posta</li>
        <li>Müşteri işlem bilgileri: randevu, aldığınız hizmet ve paketler, ödeme kayıtları</li>
        <li>İşlem güvenliği: giriş kayıtları, IP adresi, denetim kayıtları</li>
      </ul>
      <h2>2. İşleme amaçları</h2>
      <ul>
        <li>Randevu oluşturulması, hatırlatılması ve hizmetin sunulması</li>
        <li>Mali kayıtların tutulması ve yasal yükümlülüklerin yerine getirilmesi</li>
        <li>Açık rızanız olması hâlinde kampanya ve bilgilendirme iletileri</li>
      </ul>
      <h2>3. Hukuki sebepler</h2>
      <p>KVKK m.5/2 (c) sözleşmenin ifası, (ç) hukuki yükümlülük, (f) meşru menfaat; ticari elektronik ileti için m.5/1 açık rıza.</p>
      <h2>4. Aktarım</h2>
      <p>Veriler; barındırma, mesajlaşma (WhatsApp Business) ve ödeme hizmeti sağlayıcılarına, yalnızca hizmetin gerektirdiği ölçüde aktarılabilir. Yurt dışı aktarım söz konusuysa KVKK m.9 hükümlerine uyulur. [SAĞLAYICI LİSTESİ]</p>
      <h2>5. Saklama süresi</h2>
      <p>Mali kayıtlar yasal saklama süreleri boyunca saklanır; diğer veriler amacın ortadan kalkmasıyla silinir veya anonimleştirilir.</p>
      <h2>6. Haklarınız (KVKK m.11)</h2>
      <p>Verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, düzeltme, silme/anonimleştirme ve itiraz haklarına sahipsiniz. Başvurularınızı [BAŞVURU E-POSTA/ADRES] üzerinden iletebilirsiniz. İşletmeler, panelden müşteri verisini dışa aktarabilir ve anonimleştirebilir.</p>
    </LegalPage>
  );
}
