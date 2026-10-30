# Pro Güzellik: canlıya geçiş hazırlığı (30.10.2026)

VPS'e kurulum yapılmadı, DNS değiştirilmedi, canlıda migration çalıştırılmadı. Sunucuda yalnızca okuma yapıldı.

## Doğrulananlar
- **Kod:** son commit `6b4a24d`, çalışma alanı temiz, 17 migration. Testlerin tamamı geçiyor: API 294+1, tarayıcı 165.
- **Docker imajları:** `proguzellik-api:6b4a24d` (254 MB) ve `proguzellik-web:6b4a24d` (248 MB) derlendi. İkisi de amd64 (VPS ile uyumlu), root olmayan kullanıcıyla ve `NODE_ENV=production` ile çalışıyor. İmajlar 17 migration'ı içeriyor.
- **VPS:**
  - x86_64, Docker 29.7.2, Compose 5.5.0;
  - disk %76 dolu (24 GB boş), kullanılabilir bellek 4,8 GB (Pro Güzellik sınırı toplam ~2,3 GB);
  - 80/443 portları ortak `edge-caddy` konteynerinde;
  - `/opt/proguzellik` yok, Pro Güzellik imajı, konteyneri, volume'u veya ağı yok.
- **İzolasyon:** planlanan adlar sunucudaki hiçbir adla çakışmıyor. Konteynerler `proguzellik-prod-*`, volume'lar `proguzellik_prod_pg` ve `proguzellik_prod_redis`, ağlar `proguzellik_prod_internal` ve `proguzellik_prod_egress`, `edge_proxy` üzerindeki takma ad `proguzellik-web`. Hiçbir port host'a açılmıyor. Diğer projelerin (pd-*, may_davetiye, bektastura-crm, prososyalmedya) veritabanı, ağ ve volume'ları kullanılmıyor.
- **E-posta DNS:** Hostinger e-posta kayıtları hazır: MX, SPF, DKIM (hostingermail-a/b/c) ve DMARC (`p=none`). VPS'ten `smtp.hostinger.com:465` adresine erişilebiliyor.
- **Sahip e-postası:** gönderen adresi, destek adresi ve sitedeki iletişim adresi `info@proguzellik.com` olarak ayarlı. Sahip hesabı kurulumda bu adresle oluşturulacak.
- **Test ödemesi canlıda kapalı:** `tok_test` dahil her ödeme 503 döner, yenileme "ödendi" sayılmaz. İlgili 45 test geçti.
- **e-Fatura kapalı:** `EINVOICE_PROVIDER=none`; fatura kesme denemesi `EINVOICE_NOT_CONFIGURED` hatası verir. Sistem resmi belge kestiğini iddia etmez.
- **Bu turda düzeltilen hata (`6b4a24d`):** canlıda WhatsApp bağlı değilken salon bildirimleri gönderilmediği halde "gönderildi" görünüyordu; telefon numarası ve mesaj metni de loglara yazılıyordu. Artık bu bildirimler "Atlandı (WhatsApp bağlı değil)" olarak kaydediliyor ve loglara yazılmıyor.

## Canlıya geçişi engelleyen eksikler
1. **DNS:** `proguzellik.com` ve `www` hâlâ park sayfasına (2.57.91.91) gidiyor; VPS adresi 187.77.73.57. Değişiklik için **onayınız** gerekiyor. CAA ve AAAA kaydı yok, bu yüzden Let's Encrypt sertifikası otomatik alınır.
2. **Caddy yapılandırması:** sunucudaki Caddyfile'ı okuma izni verilmedi. Bloğu eklemeden önce dosyanın yedeğini alıp okumam gerekiyor; bunun için izin vermeniz ya da bu adımı kendiniz yapmanız gerekiyor.
3. **Fiyatlar:** veritabanına migration ile gelen paket fiyatları (499 / 999 / 1.799 TL aylık) demo değerleridir ve site açılınca `/fiyatlar` sayfasında görünür. Kurulumdan sonra, DNS'ten **önce**, `/platform` → Paketler'den onaylı fiyatlar girilmeli.
4. **Şirket bilgileri ve KDV:** unvan, adres, telefon, vergi dairesi/numarası, IBAN ve KDV oranı (fiyatlara dahil mi, hariç mi) yok. Bunlar girilmeden sitede şirket bilgisi ve KDV notu görünmez.
5. **Hukuki metinler:** KVKK, gizlilik ve çerez metinleri avukat onayı bekliyor. Kullanım Koşulları'ndaki köşeli parantezli alanlar (şirket unvanı, ödeme koşulları, sorumluluk, yetkili mahkeme) boş.

## Açılış için gerekmeyen ama eksik olanlar
- **SMTP parolası:** `info@proguzellik.com` posta kutusunun parolası. Parolayı sohbette paylaşmayın; sunucudaki `.env` dosyasına siz girin. SMTP gelene kadar davet ve parola sıfırlama e-postaları gitmez, ücretsiz deneme kaydı da kapalı kalır.
- **Online ödeme sağlayıcısı ve e-Fatura entegratörü:** yok; ikisi de kapalı. Abonelikler sahip panelinden elle yönetilir.
- **WhatsApp Business hesabı:** yok; WhatsApp bildirimleri kapalı.
- **Yapay zekâ asistanı:** API anahtarı olmadan, işletmenin gerçek verisinden kural tabanlı özet üretiyor. Yanıltıcı bir şey göstermiyor.

## Güvenli kurulum sırası (her adım ayrı onayla)
1. **Yedek ve durum kaydı:** `/opt/edge/Caddyfile` yedeği ve `docker ps` çıktısı alınır.
2. **İmajları taşı:** `docker save … | ssh … docker load` ile 6b4a24d imajları sunucuya yüklenir. Mevcut servisler etkilenmez.
3. **`first-install.sh 6b4a24d`:** sırları sunucuda üretir, ön kontrolü yapar, boş veritabanına migration uygular, uygulamayı başlatır ve ilk yedekle geri yükleme tatbikatını yapar. Kayıt, e-posta ve ödeme kapalı kalır, ortak ağa bağlanılmaz.
4. **Sahip hesabı:** siz kendi terminalinizde `create-owner` ile `info@proguzellik.com` hesabını açarsınız; ilk girişte 2FA kurulur.
5. **Gece yedeği:** yedekleme cron'u eklenir.
6. **Veri girişi:** SSH tüneliyle panele girip onaylı fiyatlar, şirket bilgileri ve KDV girilir. Site henüz yayında değildir.
7. **Ortak ağ ve Caddy:** web ortak ağa bağlanır, Caddy bloğu eklenir, `caddy validate` ve ardından `caddy reload` çalıştırılır. **Onay gerekir.**
8. **DNS:** `@` ve `www` A kayıtları 187.77.73.57'ye çevrilir (TTL 300). **Onay gerekir.**
9. **Duman testi:** site, giriş, `/platform` ve sertifika kontrol edilir. Sorun çıkarsa Caddy yedeğine ve `rollback.sh`'a dönülür; DNS park adresine geri alınır.
10. **Sonra:** SMTP parolası girilir ve test e-postası gönderilir. Hukuki metinler onaylanınca ücretsiz deneme açılır.

**Geri dönüş:** uygulama `rollback.sh <önceki-sürüm>` ile geri alınır. Veritabanı, sürüm öncesi yedekten yeni bir veritabanına yüklenir. Yayından kaldırmak için Caddy yedeğine dönülür; diğer siteler etkilenmez. Ayrıntılar: `docs/deployment.md` §10.
