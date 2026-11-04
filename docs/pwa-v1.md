# PWA V1.0: salon uygulaması, müşteri portalı, mobil panel, anlık bildirim

Bu belge PWA V1.0'ın nasıl açılıp kapatıldığını, pilot planını, geri alma yolunu ve canlıya çıkmadan önce
tamamlanması gereken işleri anlatır. Kod yerelde geliştirildi ve test edildi; **canlıda hiçbir şey açılmadı.**

## 1. Açma/kapama düzeni (iki kat)

| Kat | Ayar | Varsayılan (canlı) | Kim değiştirir |
|---|---|---|---|
| Ortam ana anahtarı | `PWA_ENABLED` (.env) | `0` → tüm işletmelerde kapalı | Sunucu yöneticisi (onaylı) |
| Push gönderim kipi | `WEB_PUSH_MODE` (.env) | `off` | Sunucu yöneticisi (onaylı) |
| İşletme bayrakları | `TenantPwaSettings` | Hepsi `false` | Yalnız SaaS sahibi: `PATCH /platform/tenants/:id/pwa` (gerekçe zorunlu, denetim kaydı) |

İşletme bayrakları (talimattaki adlarıyla):

- `business_pwa_enabled`: işletme ve personel mobil paneli (Bugün, Bildirim merkezi, alt menü)
- `customer_pwa_enabled`: salonun ana ekrana eklenebilir uygulaması (manifest, simge, service worker)
- `customer_booking_enabled`: müşteri portalı (e-posta koduyla giriş, randevu al/gör/değiştir/iptal)
- `customer_session_tracking_enabled`: müşteri uygulamasında paket ve kalan seans (portal açık değilse çalışmaz)
- `web_push_enabled`: anlık bildirim (ayrıca `WEB_PUSH_MODE` ≠ off olmalı)

`PWA_ENABLED=0` iken bayraklar veritabanında açık olsa bile hepsi kapalı sayılır. Bayraklar kapalıyken `/r/{slug}`
eski anonim online randevu akışını aynen gösterir (tarayıcı testiyle doğrulandı).

İşletme sahibi/yöneticisi bayrakları değiştiremez (veritabanında sütun yetkisi yok, testli). Yalnızca marka (ad, renk,
logo, simge) ve müşteri iptal/değişiklik kurallarını `/panel/uygulama` sayfasından düzenler.

## 2. Canlıya alma sırası (her adım ayrı onay)

1. **Kod dağıtımı, özellikler kapalı.** `infra/production/deploy-pwa-v1.sh <sürüm>`: yedek + geri yükleme testi,
   2 migration (`20261104160000_pwa_v1`, `20261104160100_pwa_v1_security`), sağlık kontrolü. PWA kapalı kalır.
2. **E-posta (SMTP) açılması.** Müşteri portalı giriş kodunu e-postayla gönderir. SMTP yoksa portal 503 döner
   (kod "gönderildi" sayılmaz). Bkz. `docs/deployment.md` "Kurumsal e-posta".
3. **Pilot işletme.** `.env`: `PWA_ENABLED=1` → `docker compose up -d api worker`. SaaS sahibi panelinden yalnız
   pilot işletmede önce `business_pwa_enabled`, sonra `customer_pwa_enabled` + `customer_booking_enabled`.
4. **Paket görünümü.** Pilot işletme paketlerini doğruladıktan sonra `customer_session_tracking_enabled`.
5. **Anlık bildirim (en son).** VAPID anahtarları üretilir (`node -e 'console.log(require("web-push").generateVAPIDKeys())'`),
   `.env`: `WEB_PUSH_MODE=live`, `VAPID_*`, `COMPOSE_FILE` sonuna `:docker-compose.egress.yml`, VPS güvenlik duvarında
   dışa 443 açık. Ardından pilot işletmede `web_push_enabled`. Önce kendi telefonumuzda "Deneme gönder".

## 3. Geri alma

| Durum | Yapılacak | Veri kaybı |
|---|---|---|
| Tek işletmede sorun | SaaS sahibi bayrağı kapatır | Yok. Müşterinin telefonundaki uygulama bir sonraki açılışta kendini kaldırır, önbelleğini siler (testli) |
| Tüm PWA | `.env` `PWA_ENABLED=0` → `docker compose up -d api worker` | Yok |
| Yalnız push | `WEB_PUSH_MODE=off` → `docker compose up -d api worker` | Yok; bekleyen bildirimler "Web Push kapalı" ile atlanır |
| Kod | `./rollback.sh <önceki sürüm>` | Yok. Migration'lar yalnız yeni tablo ve boş olabilen 2 sütun ekler; eski kod bunları yok sayar |

Veritabanı değişiklikleri geri alınmak istenirse (gerekmez): yeni 8 tablo ve `Appointment.portalIdentityId`,
`Appointment.idempotencyKey` sütunları kaldırılabilir; önce yedek alınır.

## 4. Sunucu (VPS) değerlendirmesi

- **Bellek/CPU:** Yeni süreç yok. Push gönderimi mevcut worker'ın BullMQ kuyruğunda; görsel işleme kütüphanesi
  (sharp) eklenmedi, simgeler Next.js'in yerleşik görsel üreticisiyle anında üretilir (önbellek 1 saat).
- **Veritabanı:** 8 küçük tablo. Logo/simge en fazla 512 KB, işletme başına yalnız güncel olanlar saklanır.
- **Ağ:** Push için worker'ın dışa 443 çıkışı gerekir (bugün kapalı). Abonelik adresleri yalnızca bilinen push
  servisleri olabilir (Google FCM, Apple, Mozilla, Microsoft); başka adrese istek atılamaz (SSRF koruması).
- **Caddy/DNS:** Değişiklik gerekmez. İstek gövdesi sınırı 2 MB, yükleme sınırı 512 KB.
- **Ölçülen süreler** (yerel, 600 randevulu işletme, 5 istek ortalaması): günlük plan 8 ms, onay bekleyenler 7 ms,
  Randevularım 7 ms, Paketlerim 5 ms, uygulama bilgisi 3 ms, boş saatler 11 ms.

## 5. iPhone (iOS) notları

- Ana ekrana ekleme yalnızca Safari'den: Paylaş → Ana Ekrana Ekle (uygulama içinde rehber var).
- Anlık bildirim yalnız **iOS 16.4+** ve yalnız **ana ekrana eklenmiş** uygulamada çalışır; Safari sekmesinde çalışmaz.
  Uygulama bu durumu algılar ve önce ana ekrana eklemeyi söyler.
- iOS'ta otomatik "yükle" düğmesi yoktur; Android/Chrome'da müşteri dokununca kurulum penceresi açılır.
- Gerçek iPhone ve Android cihazda deneme **yapılmadı** (canlı push onay gerektirir). Pilotta ilk iş olarak denenmeli.

## 6. Hukuki metin ve çerez envanteri: gerekli güncellemeler

Bu bölüm hukuki metin **yazmaz**; yalnız neyin değiştiğini ve hangi metnin güncellenmesi gerektiğini listeler.

**Veri sorumlusu / veri işleyen ayrımı:** Müşteri portalında işlenen müşteri verisinin (e-posta, ad, telefon, randevu,
paket, bildirim tercihi) veri sorumlusu **salondur**; Pro Güzellik bu veriyi salon adına **veri işleyen** olarak
işler. Pro Güzellik'in kendi işletme müşterileri (salon sahipleri ve personeli) için ise veri sorumlusu Pro Güzellik'tir.

Yeni işlenen veriler ve depolama:

| Öğe | Nerede | Süre | Not |
|---|---|---|---|
| `pg_cs` çerezi | Tarayıcı, yalnız `/r/{salon}` yolunda | 30 gün veya çıkış | Kesinlikle gerekli; HttpOnly, Secure, SameSite=Lax; salon başına ayrı |
| Doğrulanmış e-posta (müşteri kimliği) | Sunucu | Süresiz (silme akışı yok, aşağıya bakın) | Bildirim tercihleri de burada |
| Doğrulama kodu | Sunucu (yalnız özet) | 10 dk geçerli | E-postayla gönderilir |
| Push aboneliği | Sunucu (adres + şifreleme anahtarı + tarayıcı bilgisi) | Kişi kapatana, çıkış yapana veya servis geçersiz sayana kadar | Bildirim içeriği yalnız salon adı ve randevu saati; müşteri adı/telefon/hizmet yok |
| Service worker + Cache Storage `pg-salon-{salon}-v1` | Tarayıcı | Uygulama kapatılınca silinir | Yalnız çevrimdışı ekranı ve simge; kişisel veri yok |
| Cache Storage `proguzellik-v3` (panel) | Tarayıcı | Sürüm değişince silinir | Mevcut; yalnız uygulama kabuğu |
| Salon logosu/simgesi | Sunucu | Değiştirilince eskisi silinir | Konum vb. üst veri (EXIF/XMP) yüklemede silinir |

Güncellenmesi gereken metinler:

1. **Çerez politikası:** `pg_cs` satırı eklenmeli; "çerez dışı depolama" bölümüne salon uygulamasının service worker
   ve önbelleği (kişisel veri içermez) eklenmeli. Mevcut sayfa yalnız `pg_token`/`pg_tenant` listeliyor.
2. **Gizlilik politikası / KVKK aydınlatma metni:** müşteri portalı (e-posta doğrulama), anlık bildirim (isteğe bağlı,
   tarayıcı izniyle) ve bildirim için kullanılan **yurt dışındaki push servisleri** (Google, Apple, Mozilla, Microsoft;
   içerik uçtan uca şifreli). Yurt dışına aktarım değerlendirmesi hukukçu tarafından yapılmalı.
3. **Salon ile Pro Güzellik arasındaki veri işleme sözleşmesi:** portal ve push verilerinin salon adına işlendiği.
4. **Müşteri portalı alt bilgisi** şu an genel KVKK/Gizlilik/Çerez sayfalarına bağlanıyor. Salonun kendi aydınlatma
   metnine bağlantı gerekip gerekmediği hukukçuya sorulmalı.

Açık konu (kod): Salon bir müşteriyi anonimleştirince randevuları portalda artık görünmez (testli). Ancak o kişinin
portal kimliği (e-posta) ve push abonelikleri silinmez. Portal kimliği silme/dışa aktarma akışı pilot öncesi eklenmeli.

## 7. Bilinen sınırlar

- SMS ile doğrulama yok (sağlayıcı gerekir: Netgsm, İleti Merkezi vb.). E-postası olmayan müşteri portalı
  kullanamaz, eski anonim online randevuyu kullanabilir.
- Müşterinin kendi yaptığı işlemde (randevu alma/iptal/değiştirme) aynı müşteriye ayrıca push gitmez; ekranda onaylanır.
- Personel başka personele aktarılan randevunun eski sahibine bildirim gitmez; yalnız yeni atanan bilgilendirilir.
- Simgede yalnız PNG/JPEG kabul edilir (iPhone uyumu); logo WebP olabilir.
