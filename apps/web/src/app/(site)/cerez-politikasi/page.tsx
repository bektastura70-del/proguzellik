import { LegalPage } from "@/components/legal";

export const metadata = { title: "Çerez Politikası" };

export default function Cerez() {
  return (
    <LegalPage title="Çerez Politikası" draft>
      <p>ProGüzellik yalnızca hizmetin çalışması için zorunlu çerezleri kullanır; reklam veya izleme çerezi kullanılmaz.</p>
      <ul>
        <li><b>pg_token</b>: oturum çerezi (httpOnly, 8 saat)</li>
        <li><b>pg_tenant</b>: seçili işletme bilgisi (8 saat)</li>
      </ul>
      <p>Zorunlu çerezler için açık rıza gerekmez; analiz çerezi eklenirse onay mekanizması kurulmalıdır.</p>
    </LegalPage>
  );
}
