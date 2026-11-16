# WhatsApp, Instagram ve yapay zekâ asistanı

Durum: 31 Ekim 2026. Kod yerelde tamamlandı ve test edildi. **Canlıya alınmadı. Gerçek Meta, Instagram ya da Anthropic hesabıyla denenmedi.** Tüm testler test modunda (Meta'ya ve yapay zekâ sağlayıcısına hiç istek gitmeden) yapıldı.

## Ne yapıldı (commit'ler)

| Adım | Commit | İçerik |
|---|---|---|
| 1 | `46fca76` | Her işletme kendi WhatsApp numarasını ve Instagram hesabını bağlar. Anahtarlar AES-256-GCM ile şifreli saklanır, API yanıtlarında yalnızca son 4 karakter görünür. |
| 2 | `c10584a` | Kurulum sihirbazı (`/panel/kanallar`): hazırlık listesi → hesap bilgileri → bağlantı doğrulama → webhook adresi ve belirteci → şablon durumları → yapay zekâ onayı → deneme mesajı. |
| 3 | `edc5698` | Paket bitişi hatırlatması (Ayarlar'da "kaç gün önce") ve hizmet bazlı "tekrar randevu" hatırlatması (Hizmetler'de "kaç gün sonra"). Her müşteriye bir kez, saat 11:00'de gider. |
| 4 | `a27dfc4` | Kampanyalar (`/panel/kampanyalar`). Asistan yalnızca burada yayında olan kampanyaları anlatır. Toplu WhatsApp duyurusu yalnızca ticari ileti izni olan müşterilere gider; canlıda `MARKETING_MESSAGES=1` olmadan kapalıdır. |
| 5 | `7a17208` | Gelen mesajlar (`/panel/mesajlar`): imza kontrollü webhook, müşteri eşleştirme, personel yanıtı, 24 saat kuralı, "RET/iptal" yazan müşterinin ticari ileti izninin kapanması. |
| 6 | `f7fc3c7` | Yapay zekâ sohbet motoru: hizmet/fiyat, çalışma saatleri, kampanya ve boş saat soruları; müşterinin açık onayıyla randevu oluşturma; emin olmadığında personele devir. |
| 7 | `5028408` | Tarayıcı testleri. Mesajlar sayfasının yeni Chrome'da çökmesi düzeltildi. |

Testler: API 380/380, tarayıcı 168 geçti (25'i bilinçli atlanan ekran görüntüsü/masaüstü testi).

## Asistanın kuralları

- Fiyat, hizmet, kampanya ve boş saat bilgisini yalnızca salonun kendi panel verisinden alır, uydurmaz.
- Randevu iki adımlıdır: önce özet + KVKK aydınlatma bağlantısı gösterilir; randevu ancak müşteri sonraki mesajında açıkça "evet/onaylıyorum" yazarsa oluşur. Bu kontrol sunucuda yapılır, modelin yorumuna bırakılmaz ("hayır", "değil", "vazgeç" içeren yanıt onay sayılmaz). Özet 30 dakika geçerlidir.
- İptal/değişiklik, şikâyet, ödeme, sağlık/cilt sorunları, anlaşılamayan sorular ve hata durumlarında konuşma personele devredilir ve asistan susar. Personel "Yapay zekâya bırak" diyene kadar yanıt vermez.
- Bir konuşmada saatte en fazla 20 yanıt; aşılırsa personele devreder.
- Yapay zekâ yalnızca Akıllı pakette, işletme sahibi yurt dışı aktarım onayını verdiyse ve kanalda açıksa çalışır.
- Canlıda gerçek yapay zekâ açılmadıysa (`AI_MODE=mock`) asistan hiçbir şey yazmaz; tüm mesajlar personele düşer.

## Canlıya alma notları (onayın olmadan yapılmayacak)

Bu kodu canlıya almak tek başına hiçbir mesaj göndermez. Üretimde `META_MODE` varsayılanı `mock` olduğu için Meta bağlantısı kapalı kalır ve gönderimler "gönderilmedi" olarak işaretlenir. `AI_MODE=mock` iken de asistan yanıt vermez.

Gerçek kullanım için sunucuda yapılacaklar:

1. Veritabanı yedeği, ardından `prisma migrate deploy` (iki yeni migration: `20261031090000_plan_price_versions` ve `20261031120000_messaging`).
2. `.env`: `META_MODE=live`. Asistan için ayrıca `AI_MODE=openai`, `OPENAI_API_KEY` ve `OPENAI_MODEL` (model adı resmi belgeden seçilir; sunucu `docker-compose.egress.yml` ile `api.openai.com`'a çıkabilmelidir). `AI_MODE=anthropic` + `ANTHROPIC_API_KEY` de desteklenir. Sahip asistanı (Sorular sayfası) `openai` kipinde kural tabanlı kalır; yalnızca gelen mesaj yanıtları OpenAI kullanır. Toplu kampanya duyurusu için ayrıca `MARKETING_MESSAGES=1`.
3. API ve worker konteynerlerinin dışarıya çıkabilmesi için `docker-compose.egress.yml` gerekir. Erişilecek adresler: `graph.facebook.com`, `graph.instagram.com`, `api.anthropic.com`, `api.openai.com`.
4. Caddy: `/api/webhooks/meta/*` adresi herkese açık olmalıdır (şu anki snippet bunu engellemiyor). Güvenlik, her bağlantının kendi App Secret'ıyla yapılan imza kontrolündedir.

## Bektaş'ın yapması gerekenler

**Meta / WhatsApp (her salon kendi hesabıyla da yapabilir; önce kendi deneme salonunuzla):**
1. Meta Business hesabı ve işletme doğrulaması (business.facebook.com).
2. developers.facebook.com'da "İşletme" türünde uygulama, WhatsApp ürünü, başka WhatsApp'ta kullanılmayan bir numara.
3. Sistem kullanıcısı için kalıcı erişim anahtarı (`whatsapp_business_messaging`, `whatsapp_business_management`) ve uygulamanın App Secret'ı.
4. Meta hesabına ödeme yöntemi (şablon mesajları ücretli).
5. Sihirbazın "Şablonlar" adımındaki 6 Türkçe şablonu WhatsApp Yöneticisi'nde aynı adla oluşturup onaya göndermek.

**Instagram:**
6. Profesyonel Instagram hesabı, uygulamaya "Instagram API (Instagram ile giriş)" ürünü, `instagram_business_manage_messages` izni. Herkese açık kullanım için Meta uygulama incelemesi (App Review) gerekir.

**Yapay zekâ:**
7. Anthropic hesabı ve API anahtarı (console.anthropic.com), ödeme/limit ayarı.

**Hukuk:**
8. KVKK aydınlatma metnine, mesajların yanıt üretmek için yurt dışındaki yapay zekâ sağlayıcısına aktarıldığının eklenmesi (metni avukat onaylamalı; ben hukuki metin yazmadım).
9. Kampanya duyurusu göndermeden önce İYS kaydı.

**Ürün kararı (ileride):** Salonların Meta panelinde uğraşmadan "Facebook ile bağlan" düğmesiyle bağlanabilmesi (Embedded Signup) için ProGüzellik'in Meta Tech Provider olması gerekir. Şu anki sihirbaz, salonun anahtarları kendi girmesine dayanır.

**Son adım:** Canlıya alma (deploy) için açık onayın.

## ProGüzellik Meta uygulaması ile bağlama (Embedded Signup) — 10 Kasım 2026

Salonlar kendi WhatsApp numaralarını tek ProGüzellik Meta uygulaması (Tech Provider, uygulama 2059349714909229) üzerinden bağlar. Elle kurulum (salonun kendi uygulaması ve anahtarları) yedek olarak durur.

- Ortam değişkenleri (dördü de tanımlı değilse düğme kapalı): `META_APP_ID`, `META_APP_SECRET` (32 hex), `META_ES_CONFIG_ID` (Facebook Login for Business yapılandırma kimliği), `META_WEBHOOK_VERIFY_TOKEN` (en az 16 karakter). Gerçek istek için ayrıca `META_MODE=live`.
- Akış: panel `/panel/kanallar/whatsapp-bagla` (Meta alan adlarına izinli ayrı CSP; tam sayfa geçişle açılır) → Meta penceresi → kod sunucuda `oauth/access_token` ile işletme anahtarına çevrilir → numaranın WABA'ya ait olduğu `/{waba}/phone_numbers` ile doğrulanır → `/{waba}/subscribed_apps` → `/{phone}/register` (6 haneli PIN, şifreli saklanır). Bağlantı kapatılınca abonelik kaldırılır.
- Ortak webhook: `https://<alan>/api/webhooks/meta` (Meta uygulama panelinde Callback URL + `META_WEBHOOK_VERIFY_TOKEN`, `messages` alanı). İmza `META_APP_SECRET` ile doğrulanır, olay `phone_number_id`'ye göre salona yönlendirilir. Bu yolla bağlanan numaralara bağlantıya özel adres kapalıdır.
- Salon, bağladıktan sonra WhatsApp Yöneticisi'nde ödeme yöntemi ekler (Meta ücretleri doğrudan salona yansır).
- Embedded Signup v2/v3 15 Ekim 2026'da kullanımdan kalktı; uygulama panelinde yapılandırma oluşturulurken güncel sürüm seçilmeli (resmi belgeden teyit edilecek).
- Yerelde `http://localhost` üzerinde Meta penceresi açılır ama giriş https ister; uçtan uca deneme canlı (https) alan adında yapılır.

## Instagram'ı bağla (Instagram API with Unified Login) — 16 Kasım 2026

Salonlar Instagram profesyonel hesaplarını aynı ProGüzellik Meta uygulaması üzerinden, anahtar girmeden bağlar. Elle kurulum (Instagram ile giriş, salonun kendi uygulaması, `graph.instagram.com`) yedek olarak durur.

- Neden bu yol: Meta uygulama sırrı ve ortak webhook WhatsApp ile aynı; sistem kullanıcısı anahtarı süresiz seçilebilir (60 günlük yenileme işi ve migration gerekmez); Facebook Sayfası şartı yok. Belge: developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
- Ortam değişkeni: `META_IG_CONFIG_ID` (Instagram için AYRI Facebook Login for Business yapılandırması; WhatsApp'ın 2374458413319534 yapılandırması kullanılamaz). Boşsa düğme kapalıdır. Ayrıca `META_APP_*` dördü ve gerçek istek için `META_MODE=live` gerekir.
- Akış: `/panel/kanallar/instagram-bagla` (Meta alan adlarına izinli ayrı CSP) → `FB.login({config_id, response_type: "code", override_default_response_type: true})` → tarayıcıdan yalnızca kod gelir (`POST /channels/instagram/connect`, yalnız sahip) → `oauth/access_token` → `GET /me/assigned_instagram_accounts?fields=id,username` (tam bir hesap şart; hesap kimliği tarayıcıdan alınmaz) → başka işletmede BAĞLI ise 409 ve Meta'da değişiklik yapılmaz → `POST /{ig-id}/subscribed_apps?subscribed_fields=messages` → `GET /{ig-id}?fields=id,username`. Anahtar şifreli saklanır; denetim kaydı `channel.instagram_connect`. Kapatınca `DELETE /{ig-id}/subscribed_apps`.
- Gönderim: `POST graph.facebook.com/{ver}/{ig-id}/messages` (sistem kullanıcısı anahtarıyla; belge bu yolu Unified Login için açıkça yazmıyor, ilk canlı denemede doğrulanacak).
- Ortak webhook `object: "instagram"`: imza `META_APP_SECRET` ile; `entry.id` yalnızca o hesabı BAĞLI tutan tek salona yönlendirilir, yankılar alınmaz. Eşleşmeyen kimlik sayısı günlüğe yazılır ("Instagram webhook: N hesap kimliği hiçbir bağlantıyla eşleşmedi") — ilk canlı denemede bu satır görülürse Meta'nın gönderdiği kimlik ile `assigned_instagram_accounts` kimliği farklıdır.
- Güvenlik: Instagram konuşmaları telefonla müşteriye otomatik bağlanmaz; müşterinin yazdığı numara kayıtlı birine aitse personele devredilir (5db42bd). Testler: `apps/api/test/instagram-connect.e2e.spec.ts`.
- Yerel deneme: `META_MODE=mock` iken sayfada "Test modunda bağla (Meta'sız)" düğmesi çıkar.

### Meta tarafında Bektaş'ın yapacakları
1. ProGüzellik uygulamasına "Instagram'da mesajları ve içeriği yönet" (Manage messaging & content on Instagram) kullanım senaryosunu ekle.
2. "API setup with Unified login" sekmesinde yeni bir Facebook Login for Business yapılandırması oluştur: izinler `instagram_basic` + `instagram_manage_messages`, anahtar süresi **Hiçbir zaman**, "Instagram Login Compatible". Yapılandırma kimliği → sunucuda `META_IG_CONFIG_ID`.
3. Webhook'larda **Instagram** nesnesi için aynı Callback URL (`https://proguzellik.com/api/webhooks/meta`) ve aynı doğrulama belirteci; `messages` alanına abone ol (şu an yalnız `whatsapp_business_account` abone).
4. `instagram_basic` ve `instagram_manage_messages` için ayrı App Review (gelişmiş erişim); 10 Kasım başvurusu yalnız WhatsApp izinlerini kapsıyor. Onaya kadar yalnız uygulamada rolü olanlar bağlayabilir; uygulama Live modda olmalı.
5. Her salon: Instagram hesabı profesyonel + bir işletme portföyünde, Instagram ayarlarında "Mesajlara erişime izin ver" açık.
