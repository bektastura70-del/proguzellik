import { LegalPage } from "@/components/legal";
import { getSiteInfo } from "@/lib/site";

/** Şirket unvanı ve iletişim bilgisi SaaS sahibi panelindeki "Şirket ayarları"ndan gelir (metinde elle yazılmaz). */
export const dynamic = "force-dynamic";
export const metadata = { title: "Gizlilik Politikası" };

export default async function Gizlilik() {
  const { company } = await getSiteInfo();
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
      <p>
        {company.legalName && <>{company.legalName}<br /></>}
        {company.address && <>{company.address}<br /></>}
        E-posta: <a href={`mailto:${company.email}`}>{company.email}</a>
        {company.phone && <><br />Telefon: <a href={`tel:${company.phone.replace(/\s/g, "")}`}>{company.phone}</a></>}
      </p>
    </LegalPage>
  );
}
