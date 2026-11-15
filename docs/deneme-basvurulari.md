# Deneme başvuruları (kayıt kapalıyken)

Kendi kendine kayıt kapalıyken (`REGISTRATION_ENABLED` canlıda kapalı), proguzellik.com/ucretsiz-deneme
sayfası bir **başvuru formu** gösterebilir. Gelen başvuru, bilgileri doldurulmuş olarak SaaS sahibi
panelinde onay bekler. SaaS sahibi **Onayla**'ya basınca işletme 7 günlük denemede açılır ve sahibine
hesap oluşturma daveti gider.

## Akış

1. Ziyaretçi formu doldurur: salon adı, yetkili, e-posta, telefon, isteğe bağlı şehir, personel sayısı, paket ve not.
   KVKK Aydınlatma Metni ve Kullanım Koşulları onayı zorunludur, ticari ileti onayı isteğe bağlıdır. **Parola istenmez.**
2. Başvurana doğrulama e-postası gider. Bağlantı 48 saat geçerlidir ve bir kez kullanılabilir.
   Doğrulanmamış başvuru panelde görünmez ve süresi dolunca günlük görevle silinir.
3. E-posta doğrulanınca başvuru **Onay bekliyor** durumuna geçer. SaaS sahibine "Yeni deneme başvurusu"
   e-postası gider (Şirket ayarlarındaki e-posta adresine, o yoksa `SUPPORT_EMAIL` adresine).
4. SaaS paneli → **Başvurular** sekmesi (sekmedeki rozet bekleyen başvuru sayısını gösterir) → **İncele**:
   - İşletme adı, sahip, e-posta, telefon, paket ve deneme süresi (7 gün) başvurudan doldurulmuş gelir; gerekirse düzeltilir.
   - **Onayla ve davet gönder**: işletme TRIAL durumunda açılır, sahibine tek kullanımlık davet gider (mevcut davet akışı:
     sahip parolasını kendisi belirler ve KVKK onayını davet sayfasında verir).
   - **Reddet**: gerekçe zorunludur ve yalnızca kayıtlarda tutulur. Başvurana otomatik e-posta **gitmez**
     (ret metni henüz onaylanmadı). Reddedilen başvurular 30 gün sonra silinir.
5. Uyarılar: e-posta başka bir kullanıcıya aitse ya da aynı telefon veya e-postayla açık bir işletme varsa, onay
   penceresi uyarı gösterir. Onay için "Kontrol ettim, yine de onayla" kutusunun işaretlenmesi gerekir.

## Güvenlik ve kötüye kullanım önlemleri

- Bayrak kapalıyken başvuru ucu, gövdeye bakmadan 403 döner.
- Çift onay uygulanır: e-posta doğrulanmadan başvuru panele düşmez.
- Hız sınırları: IP başına saatte 5 başvuru, e-posta başına saatte 3 başvuru, IP başına saatte 20 doğrulama.
  Aynı telefonla en fazla 3 açık başvuru olabilir.
- Botlara karşı gizli alan (bal küpü) var: bu alan doluysa başvuru sessizce yok sayılır. Yanlış pozitifler görünsün diye
  denetime yalnızca IP ile `trial_application.honeypot` kaydı düşer.
- Onaylar: sahip daveti kabul ettiğinde başvuruda verilen KVKK, Kullanım Koşulları ve ticari ileti tercihleri,
  başvurunun sürüm ve IP bilgisiyle `UserConsent` tablosuna yazılır (kendi kendine kayıttaki gibi).
- Hesap varlığı sızdırılmaz: kayıtlı bir e-postayla başvurulduğunda yanıt aynıdır, başvuru yazılmaz ve hesap
  sahibine "hesabınız zaten var" e-postası gider.
- Canlıda SMTP yoksa başvuru hiçbir şey yazılmadan 503 ile reddedilir.
- `TrialApplication` tablosuna yalnızca platform rolü erişir. İşletme rolünün bu tabloda yetkisi yoktur;
  ayrıca RLS açık ve zorunludur.
- Doğrulama belirtecinin yalnızca özeti (hash) saklanır. Belirteç URL'de değil, istek gövdesinde gönderilir.
  Doğrulama sayfası, bağlantı açılır açılmaz değil düğmeye basılınca gönderir (e-posta tarayıcılarının
  bağlantıyı önceden açması başvuruyu iletmez).
- Onay tek işlemde (transaction) yapılır: başvuru sahiplenilir, işletme ve davet oluşturulur. Aynı anda gelen
  iki onaydan yalnızca biri işletme açar, diğeri 409 alır. İşletme oluşturma başarısız olursa başvuru beklemede kalır.
- Denetim kayıtları: `trial_application.submitted`, `trial_application.verified`, `trial_application.existing_email`,
  `platform.trial_application_approved` (düzeltilen alanların adlarıyla), `platform.trial_application_rejected`.
  Ardından mevcut akıştaki `platform.tenant_created` ve `platform.invite_sent` kayıtları gelir.

## Bayrak

| Ortam değişkeni | Davranış |
|---|---|
| `TRIAL_APPLICATIONS_ENABLED` tanımsız | Canlıda kapalı: sayfa eskisi gibi yalnızca iletişim bilgisini gösterir. Geliştirme ve test ortamında, kayıt kapalıysa açık. |
| `TRIAL_APPLICATIONS_ENABLED=1` | Kayıt kapalıyken başvuru formu açık. SMTP yoksa preflight hata verir. |
| `REGISTRATION_ENABLED=1` | Kendi kendine kayıt formu gösterilir; başvuru formu her durumda kapalıdır. |

Owner paneli bayraktan bağımsızdır: mevcut başvurular bayrak kapatılsa da onaylanabilir veya reddedilebilir.

## Veritabanı

- `20261105090000_trial_applications`: `TrialApplication` tablosu ve `TrialApplicationStatus` enum'u eklenir.
  Ayrıca telefon biçimi kontrolü, her e-posta için tek açık başvuru (kısmi benzersiz dizin), işletme rolünden
  yetki kaldırma ve platform rolüne yetki verme.
- `20261105090100_trial_applications_rls`: RLS açık ve zorunlu.
- Yalnızca ekleme yapar: mevcut tablolarda veri değişmez. Geri almak için tabloyu silmek gerekmez; eski
  sürüm bu tabloyu kullanmaz.

## Testler

- API: `apps/api/test/trial-applications.e2e.spec.ts` (18 test). Kapsadığı konular: bayrak, SMTP yokken 503,
  doğrulanmamışın listede görünmemesi, bal küpü, hesap sızdırmama, aynı e-postayla yeniden başvuru, alan doğrulama,
  günlük temizlik, işletme rolünün erişememesi, yetki, onay, eşzamanlı onay, uyarı teyidi, başarısız onayda
  başvurunun beklemede kalması, ret ve 404.
- Tarayıcı: `REGISTRATION_ENABLED=0 pnpm --filter @proguzellik/e2e test:e2e trial-applications`. Form, doğrulama
  sayfası, SaaS panelinde önceden doldurulmuş onay penceresi ve davet e-postasının gitmesi denenir. Normal
  çalıştırmada (kayıt açık), kayıt formunun değişmediği denetlenir.

## Canlıya alma (her adım ayrı onay ister)

1. **Kod dağıtımı, form kapalı**: amd64 imajlar oluşturulur, sunucuya yüklenir, ardından
   `infra/production/deploy-trial-applications.sh <sürüm>` çalıştırılır. Betik şunları yapar: yedek alır ve
   geri yükleme testi yapar, eski imajı arşivler, 2 migration'ı uygular, sağlık kontrolü yapar ve `/auth/registration`
   ucunun `applications:false` döndüğünü doğrular. Site görünüşte değişmez.
2. **Formu açma**: sunucuda `.env` dosyasına `TRIAL_APPLICATIONS_ENABLED=1` eklenir, ardından
   `docker compose up -d --no-deps api` çalıştırılır (preflight SMTP'yi kontrol eder). Bir deneme başvurusu
   yapılıp panelden reddedilerek kontrol edilir.
3. **Geri alma**: önce bayrak `0` yapılır ya da satır silinir (form anında kapanır). Kodun geri alınması gerekirse
   `./rollback.sh <eski sürüm>` kullanılır. Migration yalnızca ekleme yaptığı için eski sürüm sorunsuz çalışır.

## Açık konular

- KVKK Aydınlatma Metni, başvuru formunda toplanan verileri (şehir, personel sayısı, not) ve bunların saklama
  sürelerini (doğrulanmamış başvuru 48 saat, reddedilen başvuru 30 gün) açıkça anmalı. Metin hukuki
  incelemeden geçmelidir.
- Ret e-postası yok: istenirse metni onaylanınca şablon eklenir.
- Onaylanan başvurular (telefon, not, IP) işletmeye bağlı olarak süresiz saklanıyor; bunlar için bir saklama süresi
  kararı verilmeli.
