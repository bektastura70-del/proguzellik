# Pro Güzellik mobil uygulaması (iOS + Android)

Durum (13.11.2026): kod yerelde `feat/mobil-uygulama` dalında. Android emülatörde baştan sona denendi. iOS projesi
üretildi ama **derlenmedi** (bu Mac'te Xcode yok). Mağazaya hiçbir şey gönderilmedi, canlı sitede hiçbir şey değişmedi.

---

## 1. Nasıl çalışır?

- **Tek uygulama, tüm salonlar.** Uygulama adı "Pro Güzellik", paket kimliği `com.proguzellik.app`. Bu kimlik ilk
  yüklemeden sonra **değiştirilemez**.
- Açılışta yerel bir giriş ekranı gelir:
  - **Randevu al:** salonun QR kodunu tarama (kamera görüntüsü yalnızca telefonda işlenir), salon bağlantısı ya da kodu
    yazma, son açılan salonlar.
  - **İşletme girişi:** salon sahibi, yöneticisi ve personeli için `/giris`. Mevcut parola, 2FA ve oturum güvenliği
    aynen geçerlidir.
- Seçimden sonra Pro Güzellik sitesinin ilgili sayfası uygulamanın içinde açılır. Oturum çerezleri cihazda kalır.
  Sonraki açılışta uygulama doğrudan son kullanılan yere gider. Sayfadaki **Salon değiştir** bağlantısı giriş ekranına
  döner.
- **Derin bağlantı:** `proguzellik://r/<salon>` her zaman çalışır. `https://proguzellik.com/r/<salon>` bağlantılarının
  doğrudan uygulamada açılması için bölüm 6'daki doğrulama dosyaları gerekir. Uygulama yalnızca Pro Güzellik alan
  adındaki izinli yolları açar (salon sayfaları, giriş, panel).
- **Uygulamaya özgü yetenekler** (Apple 4.2 "yalnızca web sarmalayıcı" reddine karşı):
  - Telefonun kendi randevu hatırlatmaları: randevudan 1 gün ve 2 saat önce, internet olmasa da gösterilir. İzin
    yalnızca kullanıcı "Hatırlatmaları aç"a dokununca istenir.
  - QR ile salon açma.
  - Çevrimdışı ekranı.
  - Derin bağlantılar.
  - iPhone'da kaydırarak geri gitme.
- **Uygulamada gizlenenler:**
  - "Ana ekrana ekle" ve tarayıcı bildirimi (Web Push) önerileri.
  - Abonelik ve ödeme sayfaları, fiyatlar, deneme kaydı ve tanıtım sitesi. Bunlara gidilirse "Bu bölüm uygulamada yok"
    sayfası açılır.
  - Bunun sebebi mağaza kurallarıdır: uygulama içinde dijital abonelik, mağazanın ödeme sistemi dışında satılamaz
    (Apple 3.1.1 / 3.1.3(b), Google Play ödemeler politikası).
- **Müşteri hesabını silme** (Apple 5.1.1(v), Google Play şartı):
  - Uygulamada: Hesabım > Hesabımı sil. E-postaya gelen yeni kodla onaylanır.
  - Uygulama dışında: `https://proguzellik.com/hesap-silme` sayfası.
  - Silinenler: portal girişi, tüm oturumlar, bildirim kayıtları ve tercihler.
  - Salonun kendi müşteri kaydı ve randevu geçmişi salonda kalır, çünkü bu kayıtların veri sorumlusu salondur. Bu durum
    ekranda açıkça yazar.

## 2. Klasörler ve komutlar

| Yer | İçerik |
|---|---|
| `mobile/src/` | Yerel giriş ekranı, çevrimdışı ekranı, bağlantı kuralları (`links.js`) |
| `mobile/scripts/build-www.mjs` | `www/` ve `capacitor.config.json` üretir |
| `mobile/android/`, `mobile/ios/` | Yerel projeler. Derin bağlantı kodu: `MainActivity.java`, `SceneDelegate.swift` |
| `mobile/assets/`, `mobile/store/` | Simge ve açılış kaynakları, mağaza görselleri |
| `apps/web/src/lib/native-app.ts` | Sitenin uygulamayı tanıması ve hatırlatma köprüsü |
| `apps/web/src/app/r/[slug]/native.tsx` | Hatırlatma kartı, Hesabımı sil, Salon değiştir |
| `apps/web/src/middleware.ts` | Uygulamada açılmayan sayfalar |
| `apps/api/src/pwa/customer-auth.service.ts` | `deleteIdentity` (hesap silme) |

Komutlar:

```bash
cd mobile && npm ci && npm test            # bağlantı kuralı testleri
npm run sync                               # canlı site hedefli (MAĞAZA DERLEMESİ BUNUNLA)
PG_BASE=http://10.0.2.2:3000 npm run sync  # yalnız emülatör denemesi, mağazaya gönderilmez
cd android && ./gradlew bundleRelease      # Google Play paketi: app/build/outputs/bundle/release/app-release.aab
```

`mobile/` pnpm çalışma alanının dışındadır. Kendi `package-lock.json`'u vardır ve sunucu imajlarını etkilemez.

## 3. Test kaydı (13.11.2026, Android 16 emülatör, yerel sunucu)

| Akış | Sonuç |
|---|---|
| Giriş ekranı, salon kodu ile açma, son salonlar, Salon değiştir | Çalıştı |
| Portal açık salon (isilti-guzellik): e-posta koduyla giriş, randevu alma, Randevularım | Çalıştı |
| Hatırlatma izni, 2 hatırlatmanın planlanması, bildirimin gösterilmesi | Çalıştı (Android tam zamanlı alarm izni istenmez, birkaç dakika oynayabilir) |
| Portal kapalı salon (ornek-kuafor): eski online randevu sayfası | Çalıştı |
| `proguzellik://r/ornek-kuafor` ile soğuk açılış | Çalıştı |
| İşletme girişi (demo hesap), panel, menüde Abonelik yok, `/panel/abonelik` → "uygulamada yok" | Çalıştı |
| Hesabımı sil (yeni kodla): kimlik silindi, oturum kapandı, hatırlatmalar silindi | Çalıştı |
| İnternet kapalıyken açılış → çevrimdışı ekranı | Çalıştı |
| QR tarama | Emülatörde kamera yok, gerçek cihazda denenmeli |
| iOS | Derlenmedi, Xcode gerekli |
| Canlı siteye karşı | Denenmedi: web/API değişiklikleri canlıda değil (bölüm 7) |

Otomatik testler: API portal testleri (hesap silme dahil) ve `mobile` bağlantı testleri geçiyor.

## 4. Mağaza metinleri (taslak, Türkçe)

**Uygulama adı (30):** Pro Güzellik
**Alt başlık, App Store (30):** Salon randevunuz cebinizde
**Kısa açıklama, Google Play (80):** Salonunuzdan randevu alın, hatırlatma alın; işletmeler panelini yönetsin.

**Uzun açıklama:**

> Pro Güzellik ile güzellik salonunuzdan dakikalar içinde randevu alın.
>
> MÜŞTERİLER İÇİN
> • Salonunuzun QR kodunu okutun ya da salon bağlantısını açın
> • Hizmeti, uzmanı ve size uygun saati seçin
> • E-posta adresinize gelen kodla parolasız giriş yapın
> • Randevularınızı görün; salonun izin verdiği sürede değiştirin veya iptal edin
> • Paketlerinizi ve kalan seanslarınızı takip edin (salon açtıysa)
> • Randevunuzdan 1 gün ve 2 saat önce telefonunuz size hatırlatsın
>
> İŞLETMELER İÇİN
> Pro Güzellik kullanan salonların sahipleri, yöneticileri ve personeli aynı uygulamadan panellerine girer:
> günün randevuları, takvim, müşteriler, kasa ve bildirimler her an yanınızda.
>
> Uygulama, Pro Güzellik altyapısını kullanan salonlarda çalışır. Hesabınızı istediğiniz zaman uygulama içinden
> silebilirsiniz.

**Anahtar kelimeler, App Store (100):** randevu,kuaför,güzellik,salon,cilt bakımı,epilasyon,manikür,berber,estetik,hatırlatma
**Kategori:** Apple "Yaşam Tarzı" (ya da "İş"). Google Play "Güzellik".
**İçerik derecelendirmesi:** anketlerde şiddet, kumar ve kullanıcılar arası sohbet "yok" olarak işaretlenir.
**Destek e-postası:** info@proguzellik.com
**Destek ve pazarlama URL'si:** https://proguzellik.com

**Görseller:** `mobile/store/`
- Google Play: `google-play/ekran-goruntuleri/` (6 adet, 1080×2160), `one-cikan-grafik-1024x500.png`,
  `uygulama-simgesi-512.png`.
- App Store: `app-store-simgesi-1024.png`. iPhone ekran görüntüleri (6.9" 1320×2868 veya 6.5" 1284×2778) iOS
  simülatöründen alınmalı. Android görüntüleri App Store'da kullanılmaz.
- Ekran görüntülerinde yerel deneme verisi var: "Işıltı Güzellik Stüdyosu" ve örnek adres/telefon. Bunlar uydurma
  demo verisidir, gerçek bir salona ait değildir. Yayından önce canlı demo salonla yeniden çekilmesi önerilir.

## 5. Gizlilik beyanları (TASLAK, hukuki inceleme gerekir)

Bu bölüm koddan çıkarılmıştır ve hukuki uyumun tamamlandığı anlamına gelmez.

**Toplanan veriler** (hepsi uygulamanın çalışması için toplanır; reklam veya izleme için kullanılmaz; üçüncü
taraflara satılmaz):

| Veri | Neden | Kimle ilişkili |
|---|---|---|
| E-posta adresi | Giriş kodu, hesap | Kullanıcı |
| Ad, soyad, telefon | Randevu kaydı (salona iletilir) | Kullanıcı |
| Randevu, paket ve seans bilgileri | Hizmetin kendisi | Kullanıcı |
| İşletme kullanıcıları: ad, e-posta, parola özeti, 2FA | Panel girişi | Kullanıcı |
| IP adresi, tarayıcı bilgisi | Güvenlik, oturum kayıtları | Kullanıcı |

**Toplanmayanlar:** konum, kişiler, fotoğraf, reklam kimliği, analiz ve çökme SDK'ları. Kamera yalnızca QR okumak için
kullanılır, görüntü kaydedilmez ve gönderilmez. Hatırlatmalar telefonda planlanır, sunucuya cihaz kimliği gitmez.

**Google Play Veri güvenliği:**
- Veri toplanıyor mu: Evet (yukarıdaki tablo).
- Paylaşılıyor mu: Hayır. Barındırma ve e-posta sağlayıcıları "hizmet sağlayıcı" sayılır, paylaşım sayılmaz.
- Aktarımda şifreli mi: Evet (HTTPS).
- Silme isteği: Evet, uygulama içinden ve https://proguzellik.com/hesap-silme adresinden.

**Apple App Privacy:**
- "Data Linked to You": Contact Info (Email, Name, Phone), User Content (randevu notları), Identifiers (User ID).
- Amaç: App Functionality.
- "Used to Track You": Hayır.

**Gizlilik politikası URL'si:** https://proguzellik.com/gizlilik-politikasi. Mağazaya göndermeden önce metne şunlar
eklenmeli (taslak madde başlıkları, hukukçu yazmalı):
- Mobil uygulama ve kamera kullanımı (yalnız QR, kayıt yok).
- Cihazda planlanan hatırlatmalar.
- Uygulama içi hesap silme ve /hesap-silme sayfası.
- Salonun veri sorumlusu, Pro Güzellik'in veri işleyen olduğu.

## 6. Sizin yapmanız gerekenler (hesaplar, ücretler, imza)

Ücretler ve kurallar değişebilir; başvuru anında resmi sayfalardan doğrulayın.

### Apple App Store
1. **Apple Developer Program** üyeliği: developer.apple.com/programs. Yıllık yaklaşık 99 USD.
   - Şirket adına açılacaksa D-U-N-S numarası ve şirketi temsil yetkisi gerekir.
   - Bireysel hesapta mağazada sizin adınız görünür.
2. **Xcode:** Mac App Store'dan kurun, Apple kimliğinizle giriş yapın. Yaklaşık 40 GB boş yer ayırın. Bu Mac'te şu an
   61 GB boş var.
3. `cd mobile && npm ci && npm run sync && npx cap open ios` ile projeyi açın.
4. Xcode'da Signing & Capabilities:
   - Team'i seçin. Bundle ID: `com.proguzellik.app`.
   - **Associated Domains** ekleyin: `applinks:proguzellik.com`. Örnek dosya: `mobile/store/ios/App.entitlements`.
5. Bir iPhone simülatöründe çalıştırıp deneyin ve ekran görüntülerini alın.
6. Product > Archive > Distribute App > App Store Connect.
7. App Store Connect'te:
   - Uygulamayı oluşturun ve bölüm 4'teki metinleri girin.
   - App Privacy formunu bölüm 5'e göre doldurun.
   - İnceleme notu ve demo hesap girin (bölüm 6.3).

### Google Play
1. **Google Play Console** hesabı: play.google.com/console. Tek seferlik yaklaşık 25 USD ve kimlik doğrulaması gerekir.
   - Kurum hesabı için D-U-N-S istenir.
   - **Yeni kişisel hesaplarda** üretime çıkmadan önce kapalı test zorunludur. Son bilinen kural: en az 12 test
     kullanıcısı, 14 gün.
2. **Yükleme anahtarı** üretin ve parolayla birlikte güvenli yerde saklayın. Kaybolursa Play desteği gerekir:
   ```bash
   ~/Android/jdk/Contents/Home/bin/keytool -genkeypair -v -keystore ~/proguzellik-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   Ardından `mobile/android/keystore.properties` dosyasını oluşturun. Bu dosya git'e girmez:
   ```
   storeFile=/Users/bektastura/proguzellik-upload.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```
3. Paketi derleyin:
   ```bash
   cd mobile && npm run sync && cd android && ./gradlew bundleRelease
   ```
   Çıktıyı (`app-release.aab`) Play Console'a yükleyin. **Play App Signing** açık kalsın.
4. Play Console'da doldurulacaklar:
   - Mağaza girişi (bölüm 4).
   - Veri güvenliği formu (bölüm 5).
   - Hesap silme URL'si: https://proguzellik.com/hesap-silme.
   - İçerik derecelendirmesi, hedef kitle (13+ önerilir), reklam içermez.
   - Uygulama erişimi için demo hesap.
5. Play Console > Uygulama imzalama sayfasındaki SHA-256 parmak izi, sunucuda `ANDROID_CERT_SHA256` değeri olarak
   girilir (bölüm 7).

### 6.3 İnceleme (demo) hesapları
Apple ve Google inceleyicileri e-posta kodu alamaz, bu yüzden çalışan bir giriş verilir. Canlıda kuruldu (sürüm 7e991c0):
- **Demo salon:** `https://proguzellik.com/r/demo-salon` (uygulamada salon kodu `demo-salon`). Gerçek veri yok:
  örnek 4 hizmet, 2 personel (Pzt–Cmt 10:00–19:00). Müşteri, randevu, ödeme kaydı yok. 2 yıllık deneme, ödeme yok.
- **İşletme girişi:** `demo-isletme@proguzellik.com` + rastgele üretilmiş parola (2FA kapalı).
- **Müşteri girişi:** `demo-musteri@proguzellik.com` + sabit 6 haneli kod. Yalnızca demo salonda ve yalnızca bu adreste
  geçer, e-posta gönderilmez. Başka salonda veya başka adreste normal (rastgele kod) akış çalışır.
- **Bilgilerin yeri:** parola ve kod sohbete veya depoya yazılmaz. Sunucuda yalnızca root'un okuyabildiği dosyadadır:
  `ssh -t prososyalmedya 'cat /opt/proguzellik/demo-inceleme.txt'`. Bunları App Store Connect > App Review Information
  ve Play Console > App access bölümüne girin.
- **İnceleme notu önerisi:** "Salon kodu: demo-salon. Müşteri girişi için e-postayı yazıp 'Kod gönder'e bir kez basın,
  ardından verilen kodu girin." Aynı adres için saatte en fazla 5 kod isteği kabul edilir (kaba kuvvete karşı).
- **İşletme parolasını yenilemek** (inceleme ekibi 2FA açarsa veya kilitlenirse; 2FA ve kilit de kalkar):
  `docker exec proguzellik-prod-api node dist/cli/create-demo-salon.js --reset-password` çıktısını ekrana değil
  600 izinli bir dosyaya yönlendirin.
- **Müşteri girişini kapatmak:** sunucu `.env` dosyasından `REVIEW_LOGIN_*` satırlarını silip
  `docker compose up -d api worker`. Kodu değiştirmek için `REVIEW_LOGIN_CODE` değerini değiştirip aynı komut.
- Kodlar: `apps/api/src/cli/create-demo-salon*.ts`, `REVIEW_LOGIN_*` (`apps/api/src/config/env.ts`), testler
  `test/demo-salon.e2e.spec.ts` ve `test/portal.e2e.spec.ts`.

## 7. Canlıya alma (her adım ayrı onayla)

1. **Web ve API dağıtımı.** Migration yok. **Yapıldı: 7e991c0** (`infra/production/deploy-app-7e991c0.sh`; geri dönüş `./rollback.sh e4c0d2e`).
   - Hesap silme ucu, /hesap-silme, uygulama algılama, uygulamada gizlenen sayfalar, `.well-known` dosyaları.
   - Normal tarayıcıda görünen değişiklikler: Hesabım'da "Hesabımı sil" kartı ve /hesap-silme sayfası. Diğer her şey
     yalnızca uygulamada etkin.
   - **Uygulama mağazaya bu dağıtımdan sonra gönderilmeli.** Aksi halde uygulama içinde abonelik bağlantıları ve tarayıcı
     bildirimi önerileri görünür.
2. **Doğrulama dosyaları.** Sunucu `.env` dosyasına `ANDROID_CERT_SHA256` ve `APPLE_TEAM_ID` eklenir, ardından web
   konteyneri yeniden başlatılır.
   - Doğrulama adresleri: `https://proguzellik.com/.well-known/assetlinks.json` ve `/.well-known/apple-app-site-association`.
3. **Demo salon ve inceleme hesabı** (bölüm 6.3). **Yapıldı**, aynı betikle.

## 8. Sonraki sürüm (2. aşama)

- **Sunucudan anlık bildirim** (FCM/APNs): randevu onayı ve iptali uygulamaya bildirim olarak gelir. Gerekenler:
  - Firebase projesi ve APNs anahtarı (sizin hesaplarınız).
  - API'de cihaz jetonu tablosu (migration) ve FCM gönderici.
  - Şu an uygulamada yalnız telefonda planlanan hatırlatmalar var. Personel bildirimleri uygulamanın Bildirim
    merkezinde listelenir.
- Takvime ekleme, biyometrik kilit.
- QR'ın gerçek cihazlarda denenmesi.
