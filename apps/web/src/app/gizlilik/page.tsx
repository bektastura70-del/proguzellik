import { LegalPage } from "@/components/legal";

export const metadata = { title: "Gizlilik Politikası" };

export default function Gizlilik() {
  return (
    <LegalPage title="Gizlilik Politikası">
      <p>ProGüzellik, salonların müşteri verilerini yalnızca ilgili salon adına (veri işleyen sıfatıyla) işler. Her salonun verisi veritabanı düzeyinde diğer salonlardan yalıtılmıştır.</p>
      <h2>Güvenlik önlemleri</h2>
      <ul>
        <li>Parolalar geri döndürülemez biçimde (bcrypt) saklanır.</li>
        <li>Oturum bilgisi tarayıcıda JavaScript erişimine kapalı çerezde tutulur.</li>
        <li>Mali kayıtlar ve denetim kayıtları değiştirilemez şekilde saklanır.</li>
        <li>Yapay zekâ asistanına müşteri kimlik bilgisi gönderilmez; yalnızca toplu işletme metrikleri kullanılır.</li>
      </ul>
      <h2>İletişim</h2>
      <p>[İLETİŞİM BİLGİLERİ]</p>
    </LegalPage>
  );
}
