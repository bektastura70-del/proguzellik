# Pro Güzellik mobil uygulaması 1.1 planı (salon seçimi, salon bulma, QR)

Durum (16.11.2026): **kod yerelde yazıldı ve test edildi** (`feat/salon-rehberi` dalı, canlıdaki 7 gün deneme sürümünün
üstünde). Canlıya alınmadı, migration hiçbir paylaşılan veritabanında çalıştırılmadı, mağazaya bir şey gönderilmedi.
Uygulama özeti bölüm 9'da.
Temel: `feat/mobil-uygulama` dalı (605e80d), 1.0.0 Google Play incelemesinde, iOS henüz gönderilmedi.

İstenen üç konu:
1. Müşterinin başka salon seçebilmesi, salon değiştirmesi, birden çok salon, son salonu hatırlama.
2. Kodu bilmeyenler için şehir > ilçe > salon seçimi (salonun açıkça izin verdiği "uygulamada listele" alanı,
   varsayılan kapalı, yalnızca halka açık bilgiler, konum izni yok).
3. Uygulama içi QR okuyucu (kamera izni, `proguzellik.com/r/<kod>` çözümü).

---

## 0. Kısa sonuç

- **1 ve 3'ün büyük kısmı 1.0.0'da zaten var.** QR okuyucu, kamera izinleri, son 6 salon listesi, son salonu
  hatırlayıp açılışta açma ve "Salon değiştir" çalışıyor. Eksik olanlar küçük: son salonlar listesinde salon adı yerine
  kod görünüyor, QR gerçek telefonda hiç denenmedi, çoklu salonda hesap silme metni yetersiz.
- **Asıl yeni iş 2. madde (salon rehberi).** Veritabanında şehir/ilçe alanı yok, yalnızca serbest metin `address` var.
  Migration, işletme paneli ayarı, herkese açık bir uç ve iki ekran gerekiyor.
- **Önerilen yol:** rehber sayfaları ve API sunucu tarafında önce yayınlanır (mağaza güncellemesi gerekmez, uygulama
  içinden de açılabilir); 1.1 mağaza sürümü yalnızca başlangıç ekranına "Salon bul" düğmesini, salon adı/logosunu ve
  küçük düzeltmeleri ekler.

---

## 1. Kodda bugün ne var (bulgular)

### 1.1 Müşteri kimliği salona bağlı
- `CustomerIdentity` her salon için ayrıdır: `@@unique([tenantId, email])` (`apps/api/prisma/schema.prisma`).
  Oturum (`CustomerPortalSession`) ve kod (`CustomerOtp`) de salona bağlıdır.
- Web vekili oturum çerezini (`pg_cs`, httpOnly) **`/r/<salon>` yoluna** yazar
  (`apps/web/src/app/r/[slug]/api/[...path]/route.ts`). Bu yüzden her salonun çerezi ayrıdır ve birbirinin yerine
  geçmez. Aynı ad taşıyan çerezler farklı yollarda yan yana durur.
- Randevu alınırken salondaki `Customer` kaydı e-postaya (yoksa telefona) göre bulunur ya da oluşturulur
  (`apps/api/src/pwa/portal.service.ts` `book`). Yani salonun müşteri kaydı salonda, veri sorumlusu salondur.
- Sonuç: **çoklu salon bugün de çalışır.** Müşteri A salonunda kodla girer, B salonuna geçip orada da kodla girer;
  A'ya döndüğünde 30 günlük oturumu durur. Her yeni salonda bir kez e-posta kodu girmek gerekir.

### 1.2 Uygulamanın başlangıç ekranı (cihazda paketli)
- `mobile/src/app.js`:
  - `pg.recent`: son açılan salonlar, en çok 6, en yeni başta (`rememberSalon`, `mobile/src/links.js`).
  - `pg.last`: son açılan yer. Uygulama açılınca internet varsa doğrudan oraya gider.
  - `proguzellik://home` ya da `?home` ile seçim ekranı zorla gösterilir ("Salon değiştir" bu yolu kullanır,
    `apps/web/src/app/r/[slug]/native.tsx`).
  - **Hata:** `openSalon` ve derin bağlantı yolu salonu `name: null` ile kaydeder; listede salon adı değil kod görünür.
  - **Eksik:** uygulama içinde bir salon sayfasından başka salona geçilirse (`/r/b` bağlantısı) `pg.last` ve
    `pg.recent` güncellenmez; çünkü bu kayıt yalnızca yerel ekranda tutulur.
- `links.js` `ALLOWED_PATHS`: yerel ekranın açabildiği yollar sabittir (`/r/...`, `/giris`, `/panel...`,
  `/platform...`, birkaç hesap sayfası). Yeni bir yol (ör. `/salonlar`) yerel ekrandan açılacaksa bu liste değişir,
  bu da **mağaza güncellemesi** demektir.
- Gezinme izni (`capacitor.config.json` `allowNavigation`) tüm `proguzellik.com` alan adını kapsar. Yani site
  içindeki bir bağlantıyla açılan **yeni web sayfaları 1.0.0 uygulamasında da çalışır**; yalnızca uygulamada yasak
  sayfalar (`apps/web/src/middleware.ts` `NATIVE_BLOCKED`: ana sayfa, fiyatlar, satın alma, deneme, abonelik)
  "uygulamada yok" sayfasına gider.

### 1.3 QR okuyucu
- Var: `mobile/src/app.js` `startScan`. WebView içinde `getUserMedia` (arka kamera) + `jsQR` (cihazda, paketli,
  ağ yok). Okunan metin `parseSalonInput` ile çözülür: `https://proguzellik.com/r/<kod>`, `www.` öneki,
  `proguzellik://r/<kod>`, çıplak kod kabul; başka alan adı reddedilir. Testler: `mobile/tests/links.test.mjs`.
- İzinler beyanlı: Android `android.permission.CAMERA` (kamera zorunlu değil), iOS `NSCameraUsageDescription`.
- **Denenmedi:** emülatörde kamera yoktu; gerçek Android ve iPhone'da QR hiç çalıştırılmadı. WebView kamera izni
  zinciri (Android'de `WebChromeClient.onPermissionRequest`, iOS'ta WKWebView medya izni) gerçek cihazda
  doğrulanmadan "çalışıyor" denemez.

### 1.4 Hesap silme salon başına
- `deleteIdentity(tenant.id, ...)` yalnızca o salondaki kimliği siler. Birden çok salonda girişi olan biri bir
  salondan silince diğerleri durur. Apple 5.1.1(v) ve Play hesap silme şartı "hesabın" silinmesini ister; çoklu salonda
  bu, ekranda ve `/hesap-silme` sayfasında açıkça anlatılmalı ya da tüm salonlar için yapılabilmeli (bkz. karar K1).

### 1.5 Salon bilgisi ve konum
- `Tenant`: `name`, `slug`, `phone`, `address` (serbest metin), `status`, `trialEndsAt`. **Şehir/ilçe alanı yok.**
- Bugün salon sayfasında (`/r/<kod>`) ad, adres ve telefon zaten herkese açık
  (`public-booking.service.ts`, `portal-client.tsx`). Ama bu "kodu bilen görür" demektir; listede çıkmak farklı bir
  açıklıktır ve ayrı izin ister.
- `Tenant` tablosunda RLS açık; herkese açık salon uçları `prisma.platform` (RLS'yi aşan rol) ile tek salonu `slug`
  üzerinden okur ve askıya alınmış/süresi bitmiş salonları dışarıda bırakır (`resolve`).
- `appInfo` (`GET /public/salons/:slug/app`, web'de `/r/<kod>/api/app`) hassas veri içermeyen ad, kısa ad, renk ve
  logo adresini verir. Son salonlar listesinin adı ve logosu buradan alınabilir.

---

## 2. Önerilen çözüm

### 2.1 Salon değiştirme ve çoklu salon (madde 1)

Öneri: **salon başına kimlik modeli korunur** (migration yok). Yapılacaklar:

Mağaza sürümü gerektirenler (`mobile/`):
- Son salonlar listesi salon adı ve logosuyla gösterilir: salon açılırken `/r/<kod>/api/app` okunur, ad ve logo
  adresi `pg.recent`'e yazılır (ağ yoksa kod gösterilir). Listede "kaldır" (uzun basma ya da çarpı) ile cihazdan silme.
- Başlangıç ekranında üst sıra: "Son salonum: <ad>" büyük düğme; altında diğer salonlar.
- Salon sayfasında başka bir salona geçildiğinde de son salonun güncellenmesi: web sayfası uygulamadaysa yerel
  köprü (`apps/web/src/lib/native-app.ts`) üzerinden `Preferences` eklentisine ya da `localStorage`'a yazar. Not:
  başlangıç ekranı yerel kökenden (`https://localhost`/`capacitor://localhost`), salon sayfası `proguzellik.com`
  kökeninden çalışır; `localStorage` paylaşılmaz. Bu yüzden ya Capacitor `Preferences` (yerel, iki tarafa açık) ya
  da açılışta "son açılan URL"yi yerel katmanın tutması gerekir. Bu, 1.0.0'daki gizli bir eksikliktir.

Sunucu tarafında yapılabilenler (mağaza gerekmez):
- Salon sayfasındaki "Salon değiştir" bağlantısının yanına (yalnızca uygulamada) "Başka salon bul" bağlantısı
  (`/salonlar`'a, bkz. 2.2).
- Hesabım ve `/hesap-silme` metni: "Bu silme yalnızca <salon> içindir. Başka salonlarda da girişiniz varsa her
  birinde ayrıca silin." (K1'de birleşik silme seçilirse bu değişir.)

Bilinçli olarak **yapılmayanlar** (K1 kararına bağlı):
- Tüm salonlarda tek hesap / tek giriş. Bu, Pro Güzellik'in salonlar arası bir müşteri profili tutması demektir:
  KVKK'da Pro Güzellik bu profil için **veri sorumlusu** olur (bugün salonlar sorumlu, Pro Güzellik işleyen), aydınlatma
  metni ve VERBİS değerlendirmesi değişir, `CustomerIdentity` yeni bir küresel tabloya bağlanır (migration), oturum ve
  çerez modeli yeniden kurulur. 1.1 için önerilmez.

### 2.2 Salon rehberi: şehir > ilçe > salon (madde 2)

**Veri modeli (migration, yalnızca ekleme, geri alınabilir):**

Seçenek A (önerilen): ayrı tablo, tek amaçlı.

```
model SalonListing {
  tenantId     String   @id @db.Uuid        // Tenant'a 1-1
  enabled      Boolean  @default(false)      // varsayılan KAPALI
  provinceCode Int                          // il plaka/resmî kodu (1-81)
  districtCode Int                          // resmî ilçe kodu
  showAddress  Boolean  @default(false)      // her alan ayrı izin
  showPhone    Boolean  @default(false)
  enabledById  String?  @db.Uuid
  enabledAt    DateTime?
  updatedAt    DateTime @updatedAt
  @@index([enabled, provinceCode, districtCode])
}
```

- Ad ve logo listede her zaman görünür (listelemenin kendisi bunlardır); adres ve telefon ayrı kutucukla.
- RLS: işletme yalnızca kendi satırını okur/yazar (mevcut `tenantId` politikası kalıbı). Herkese açık uç
  `prisma.platform` ile okur ama yalnızca açık alan listesi seçer (`select` ile, `Tenant`'tan `name`, `slug`; logo
  `TenantPwaSettings.logoAssetId`).
- İl/ilçe listesi **elle yazılmaz.** Resmî kaynaktan (İçişleri Bakanlığı / Nüfus ve Vatandaşlık İşleri il-ilçe kodları
  ya da TÜİK ADNKS idari birim listesi) tek seferlik alınıp `packages/shared` içine sabit veri olarak konur; kaynak ve
  tarih dosyada yazılır. Hangi kaynağın kullanılacağı ve lisans durumu kodlamadan önce doğrulanacak.
- Seçenek B: `Tenant`'a sütun eklemek. Daha az kod ama `Tenant` zaten kalabalık ve RLS'yi aşan sorgularda yanlışlıkla
  fazla alan seçme riski artar. Önerilmez.

**İşletme paneli (web, sunucu tarafı):**
- Yeni kart: Ayarlar > Mobil uygulama / Online randevu altında "Pro Güzellik uygulamasında listelensin".
  - Varsayılan kapalı. İl ve ilçe seçmeden açılamaz.
  - Kutucuklar: "Adres görünsün", "Telefon görünsün".
  - **Önizleme:** listede tam olarak ne görüneceği kartta gösterilir.
  - Açıklama: "Şahıs işletmelerinde ad, telefon ve adres kişisel veri olabilir; listeden istediğiniz zaman
    çıkabilirsiniz."
  - Yalnız işletme sahibi (OWNER) değiştirebilir; değişiklik denetim kaydına (`AuditLog`, `salon.listing_enabled` /
    `salon.listing_disabled`) yazılır, kim ve ne zaman tutulur.
- Platform paneli (`/platform`): listelenen salonlar ve "listeden çıkar" (kötüye kullanım için). K2'de onaylı model
  seçilirse burada onay kuyruğu olur.

**Herkese açık API (yeni, girişsiz):**
- `GET /public/directory/provinces` → yalnızca en az bir listelenen salonu olan iller ve salon sayısı.
- `GET /public/directory/provinces/:il/districts` → aynı şekilde ilçeler.
- `GET /public/directory/salons?province=&district=` → `[{ slug, name, logoUrl, address?, phone? }]`, ada göre sıralı,
  sayfalı (ör. 50).
- Filtre: `enabled = true` **ve** salon `TRIAL` (süresi bitmemiş) ya da `ACTIVE` **ve** müşteri portalı ya da online
  randevu açık. Askıya alınan, süresi biten ya da randevuyu kapatan salon kendiliğinden listeden düşer (veri silinmez).
- Arama kutusu yok (ilk sürümde); serbest metin araması kazıma ve kötüye kullanım yüzeyini büyütür.
- Hız sınırı (`RateLimitService`, IP başına), `Cache-Control: public, max-age=300`. Web vekili:
  `apps/web/src/app/api/salonlar/...` ya da sayfa sunucu bileşeninde doğrudan çağrı.
- Arama motorları: `/salonlar` için `noindex` (K4). Listenin toplu kazınmasını kolaylaştırmamak için ve salonların
  izni "uygulamada listele" olduğu için. İsterlerse ileride ayrı bir "web'de de görün" izni.

**Ekranlar:**
- Web: `/salonlar` (il listesi) → `/salonlar/<il>` (ilçeler) → `/salonlar/<il>/<ilçe>` (salon kartları: logo, ad,
  izin verildiyse adres/telefon, "Randevu al" → `/r/<kod>`). Uygulama içinde ve dışında aynı sayfa; uygulama içinde
  üst çubukta "Ana ekran".
- Uygulama 1.1: başlangıç ekranına "Salon bul (şehir/ilçe)" düğmesi; `links.js` `ALLOWED_PATHS`'e
  `/^\/salonlar(\/[a-z0-9-]+){0,2}$/`.
- **Boş durum:** başta çok az salon listelenecek. İl listesinde yalnızca salonu olan iller çıkar; hiç yoksa "Henüz
  listelenen salon yok. Salonunuzun QR kodunu okutun ya da salon bağlantısını yazın." ve QR/kod alanlarına dönüş.
  Mağaza incelemesinde demo salon listede görünsün diye `demo-salon` için listeleme açılabilir (K5).
- Konum izni **istenmez**, cihaz konumu kullanılmaz; seçim tamamen el ile.

### 2.3 QR okuyucu (madde 3)

- 1.1'de iş: **gerçek cihaz testi.** En az bir Android (Play dahili test) ve bir iPhone (TestFlight) ile:
  izin isteme, izin reddi ve sonra Ayarlar'dan açma, karanlık ortam, ekrandan QR, kağıt QR, `www.` ve `http://`
  bağlantılar, başka alan adı QR'ı (reddedilmeli), uygulama arka plana gidip gelince kameranın kapanması.
- Panelde salonun QR'ı zaten `proguzellik.com/r/<kod>` üretiyorsa ek iş yok; üretmiyorsa işletme paneline "QR kodunu
  indir/yazdır" (sunucu tarafı) eklenir. (Kodlamadan önce paneldeki mevcut QR üretimine bakılacak.)
- Gerçek cihazda WebView kamerası sorun çıkarırsa B planı (K3): yerel tarayıcı eklentisi (ör.
  `@capacitor-mlkit/barcode-scanning` ya da `@capacitor/barcode-scanner`). Artısı: hızlı, güvenilir, el feneri.
  Eksisi: mağaza güncellemesi, Android'de Google ML Kit (Google Play hizmetleri) bağımlılığı → Play Veri güvenliği ve
  Apple gizlilik beyanında üçüncü taraf SDK'sı olarak değerlendirilmeli (ML Kit cihazda çalışır, ancak SDK'nın kendi
  beyanı okunmalı). Önerilen: önce mevcut çözümü gerçek cihazda denemek, yalnızca sorun varsa eklentiye geçmek.
- Salon dışı QR'larda (ör. kampanya bağlantısı) davranış değişmez: reddedilir, açıklama gösterilir.

---

## 3. KVKK, gizlilik ve mağaza beyanları

| Konu | Etki | Yapılacak |
|---|---|---|
| Salon rehberi | Salonun ticari bilgisinin daha geniş yayımı: uygulamada ve herkese açık `proguzellik.com/salonlar` sayfasında (arama motorlarına kapalı, ama bağlantıyı bilen herkes açabilir); onay kutusu metni bunu açıkça söyler. Şahıs işletmesinde ad/telefon/adres kişisel veri. | Açık, geri alınabilir, alan bazlı izin; önizleme; denetim kaydı; "Kullanım koşulları"na listeleme maddesi (hukukçu yazmalı). Salon sahibinin onay metni (kutucuk metni) hukuki incelemeden geçmeli. |
| Müşteri tarafı | Rehber girişsizdir, müşteri verisi toplamaz; konum yok. | Gizlilik politikasında yeni veri yok. Yalnızca "salon rehberi işletmelerin kendi izniyle yayımladığı bilgilerden oluşur" cümlesi. |
| Çoklu salon (salon başına kimlik) | Bugünkü model aynen sürer; Pro Güzellik veri işleyen. | Hesap silme ekranında "yalnızca bu salon" açıklaması; `/hesap-silme` sayfasında çoklu salon talimatı. |
| Tek hesap (K1'de seçilirse) | Pro Güzellik salonlar arası profil için veri sorumlusu olur. | Aydınlatma metni, VERBİS değerlendirmesi, açık rıza gerekip gerekmediği hukukçuya sorulmalı. 1.1 kapsamı dışında önerilir. |
| Kamera | Değişmez (zaten beyanlı, yalnız QR, görüntü kaydedilmez/gönderilmez). | Yerel eklentiye geçilirse (K3) SDK veri beyanı kontrolü. |
| Son salonlar | Cihazda tutulur, sunucuya gitmez. | Değişiklik yok; Ayarlar'dan veya listeden silinebildiği söylenir. |

**Google Play Veri güvenliği:** rehber ve QR mevcut yöntemle kalırsa **değişmez** (yeni veri türü yok). Yerel QR
eklentisi eklenirse SDK beyanı okunup form güncellenir.
**Apple App Privacy:** aynı. Konum toplanmadığı için "Location" eklenmez.
**Mağaza metinleri:** 1.1 açıklamasına "Şehir ve ilçeye göre salon bulun (salonun izin verdiği bilgilerle)" eklenir;
"yakınımdaki salonlar" gibi konum çağrıştıran ifade kullanılmaz.
**Apple 4.2 (yalnızca web sarmalayıcı):** rehber web sayfası olsa da yerel başlangıç ekranından açılır; mevcut yerel
parçalar (QR, hatırlatma, çevrimdışı, derin bağlantı) duruyor. Risk düşük.

---

## 4. Riskler

| Risk | Olasılık | Önlem |
|---|---|---|
| WebView QR gerçek cihazda çalışmıyor (özellikle Android izin zinciri) | Orta | Dahili test/TestFlight ile erken deneme; B planı yerel eklenti (K3). |
| Yerel ekran ile site arasında son salon bilgisi paylaşılmıyor (farklı köken) | Yüksek (bugün de var) | Capacitor `Preferences` ya da yerel katmanda son URL; test. |
| RLS'yi aşan herkese açık rehber sorgusu fazla alan sızdırır | Düşük, etkisi yüksek | Ayrı tablo, açık `select`, uçtan uca test ("kapalı salon görünmez", "telefon izni yoksa telefon yok", "askıdaki salon görünmez"). |
| Rehber kazınması / rakip salonların listeyi toplaması | Orta | Arama yok, sayfalı, hız sınırı, `noindex`; yalnızca izinli alanlar. |
| Sahte/uygunsuz salon adı listede | Düşük | Platform panelinde "listeden çıkar"; K2'de onaylı model. |
| Boş rehber kötü izlenim bırakır | Yüksek (başta) | Yalnızca salonu olan iller; boş durum metni; QR/kod yolunun öne çıkması. |
| İl/ilçe verisinin yanlış ya da eski olması | Düşük | Resmî kaynaktan alma, kaynak/tarih kaydı, kod ile saklama (ad değişse de kod kalır). |
| 1.0.0 incelemedeyken 1.1 gönderimi karışıklık | Düşük | 1.0.0 onaylanmadan 1.1 mağazaya gönderilmez; sunucu tarafı ayrı yayınlanır. |
| Hesap silme çoklu salonda eksik algılanır (mağaza reddi) | Düşük-orta | Açık metin; isteğe bağlı "tüm salonlardaki girişlerimi sil" akışı (K1). |

---

## 5. Sürüm stratejisi

**Aşama S1, yalnızca sunucu (mağaza güncellemesi yok, 1.0.0 kullanıcıları da yararlanır):**
- Migration `SalonListing` (yalnızca ekleme; geri dönüşte tablo boş kalır, eski sürüm etkilenmez).
- İşletme paneli listeleme kartı, platform paneli listesi, herkese açık rehber API'si, `/salonlar` sayfaları.
- Salon sayfasında (uygulamadaysa) "Başka salon bul" bağlantısı → 1.0.0'da da `/salonlar` açılır (izinli alan adı).
- Hesap silme metinleri.
- Yayın: mevcut yöntem (yeni imaj, yedek, migration, duman testi, otomatik geri dönüş), ayrı onayla.

**Aşama S2, mağaza sürümü 1.1.0 (yapı 10100):**
- Başlangıç ekranında "Salon bul" düğmesi, `ALLOWED_PATHS`'e `/salonlar`.
- Son salonlar: ad + logo, kaldırma, "Son salonum" öne çıkarma, siteyle paylaşılan son salon (Preferences).
- QR gerçek cihaz düzeltmeleri; gerekirse yerel tarayıcı eklentisi (K3).
- `node scripts/set-version.mjs 1.1.0 && npm run sync`, Android imzalı `.aab`, iOS arşiv.
- Dağıtım: Play dahili test → üretim; TestFlight → App Store. 1.0.0 Play onayı gelmeden 1.1 gönderilmez.

**iOS zamanlaması (K6):** iOS henüz gönderilmediği için ilk iOS gönderimi doğrudan 1.1.0 olabilir. Böylece Apple
incelemesinden bir kez geçilir ve iki mağaza 1.1'de eşitlenir.

---

## 6. Tahmini iş kalemleri

Tahminler kabadır (tek geliştirici, test dahil), gerçek cihaz testi bekleme süreleri hariç.

| # | İş | Yer | Tahmin |
|---|---|---|---|
| 1 | İl/ilçe resmî verisinin alınması, `packages/shared`'a sabit veri + kaynak notu + test | shared | 0,5 gün |
| 2 | `SalonListing` migration, RLS politikası, Prisma modeli | api | 0,5 gün |
| 3 | İşletme ayarı ucu (OWNER, denetim kaydı, doğrulama) + testler | api | 0,5 gün |
| 4 | Herkese açık rehber uçları (filtre, açık select, sayfalama, hız sınırı, önbellek) + uçtan uca testler (kapalı/askıda/izinsiz alan görünmez) | api | 1 gün |
| 5 | Platform paneli: listelenenler, listeden çıkarma | api + web | 0,5 gün |
| 6 | İşletme paneli listeleme kartı ve önizleme | web | 0,5 gün |
| 7 | `/salonlar` sayfaları (il, ilçe, salon kartları, boş durum, `noindex`) + e2e | web | 1 gün |
| 8 | Salon sayfasında "Başka salon bul" (yalnız uygulamada), hesap silme metinleri | web | 0,25 gün |
| 9 | S1 yayın betiği (migration'lı), yedek, duman testi | infra | 0,5 gün |
| 10 | Uygulama: son salonlar ad/logo/kaldırma, "Son salonum", Preferences ile paylaşılan son salon | mobile | 1 gün |
| 11 | Uygulama: "Salon bul" düğmesi, `ALLOWED_PATHS`, testler | mobile | 0,25 gün |
| 12 | QR gerçek cihaz testi (Android + iPhone) ve düzeltmeler | mobile | 0,5-1 gün |
| 13 | (K3'e bağlı) Yerel QR eklentisi, beyan kontrolü | mobile | +1 gün |
| 14 | 1.1.0 sürüm numarası, imzalı Android paketi, iOS arşiv, ekran görüntüleri, mağaza metni | mobile | 0,5 gün |
| 15 | Belge güncellemesi (`docs/mobil-uygulama.md`) | docs | 0,25 gün |

Toplam: yaklaşık **8-9 iş günü** (yerel QR eklentisiyle 9-10). Bunun yaklaşık 5 günü sunucu tarafıdır (S1).

---

## 7. Sizin vermeniz gereken kararlar

- **K1. Müşteri hesabı: salon başına mı, tek hesap mı?**
  Öneri: **salon başına kalsın** (bugünkü model, migration yok, KVKK rolü değişmez). Her yeni salonda bir kez e-posta
  kodu girilir. İsterseniz ek olarak "tüm salonlardaki girişlerimi sil" akışı eklenebilir (cihazdaki son salonlar
  üzerinden, her salon için kod ister).
- **K2. Rehbere giriş: salon kendisi mi açar, siz mi onaylarsınız?**
  Öneri: **salon kendisi açar**, siz platform panelinden gerektiğinde çıkarırsınız. Onaylı model daha güvenli ama her
  salon için sizin işiniz olur.
- **K3. QR: mevcut WebView okuyucusu mu, yerel eklenti mi?**
  Öneri: **önce mevcut okuyucu gerçek cihazda denensin**, sorun çıkarsa eklentiye geçilsin.
- **K4. Rehberde hangi alanlar, web'de aranabilir mi?**
  Öneri: ad + logo her zaman; adres ve telefon salonun ayrı izniyle; `/salonlar` arama motorlarına kapalı (`noindex`).
- **K5. Demo salon rehberde görünsün mü?** Öneri: evet (mağaza incelemesi ve boş rehber için); adı zaten "Demo"
  içeriyor mu kontrol edilir.
- **K6. iOS ilk gönderimi 1.0.0 mı, doğrudan 1.1.0 mı?** Öneri: Apple hesabı hazır olduğunda doğrudan 1.1.0.
- **K7. Listeleme onay metni ve kullanım koşulları maddesi** hukukçuya yazdırılacak mı? (Metinleri uydurmuyoruz;
  taslak başlıklar verilir.)

## 8. Kodlamaya başlamadan önce bakılacaklar

- İşletme panelinde salon QR'ının nasıl üretildiği (yoksa iş kalemi eklenir).
- Mevcut portal testlerinin (`portal`, `rls`, `demo-salon`) bu dalda yeşil olduğu.
- İl/ilçe resmî kaynağının erişimi ve kullanım şartları.
- Capacitor `Preferences` eklentisinin yerel ve site kökeni arasında çalıştığı (küçük bir deneme).

---

## 9. Uygulama durumu (16.11.2026, yerel)

Kararlar (kullanıcı ayrıca yanıt vermediği için plandaki öneriler uygulandı): K1 salon başına hesap, K2 salon kendisi
açar / SaaS sahibi çıkarır, K3 mevcut WebView QR (gerçek cihaz testi bekliyor), K4 ad+logo her zaman, adres/telefon ayrı
izinle, `/salonlar` noindex, K5 demo salon panelden listelenecek (aşağıda), K6 iOS ilk gönderim 1.1.0, K7 onay metni
taslak, hukukçu okumalı.

**İl/ilçe verisi:** T.C. İçişleri Bakanlığı e-İçişleri "Mülki İdare Bölümleri" sayfasından 16.11.2026'da okundu
(81 il, 973 ilçe; sayfanın kendi sayımı 922 ilçe + 51 merkez ilçe). Bakanlık kodları saklanır (il kodu = plaka).
`apps/api/src/directory/tr-admin-units.ts` üretilmiş dosyadır; yeniden üretmek için `apps/api/scripts/admin-units/`
(`fetch.py` il başına bir istek atar, `generate.py` TS dosyasını yazar). Elle eklenen ya da düzeltilen kayıt yok.
Kaynak sitenin kullanım şartları ayrıca incelenmedi (kamu idari birim adları ve kodları); yayından önce bakılması önerilir.

**Veritabanı:** `20261116120000_salon_listing` (yalnızca yeni tablo `SalonListing`; mevcut tablolara dokunmaz).
RLS + sütun yetkileri: işletme kendi satırını yazar ama `blockedAt/blockedReason` yazamaz, silemez; platform rolü
yalnızca bu iki alanı günceller. CHECK: açık kayıt il ve ilçe ister. Geri dönüşte eski sürüm tabloyu okumaz.

**API** (`apps/api/src/directory/`):
- `GET /directory/units`, `GET /directory/listing` (sahip, yönetici), `PUT /directory/listing` (yalnız sahip; denetim
  kaydı `salon.listing_enabled|disabled|updated`).
- `GET /public/directory/provinces`, `/provinces/:il`, `/provinces/:il/:ilce?sayfa=` (girişsiz, IP başına dakikada
  120, sayfa 50, yalnızca ad/kod/logo ve izin verilen adres/telefon).
- Görünürlük: açık + engelli değil + online randevu açık + plan ONLINE_BOOKING + ACTIVE ya da süresi bitmemiş TRIAL
  (salon sayfası `/r/<kod>` ile aynı kural).
- `GET /platform/directory`, `POST /platform/directory/:id/block|unblock` (neden zorunlu, denetim kaydı).

**Web:** Ayarlar > "Pro Güzellik uygulamasında listelensin" kartı (önizleme, il/ilçe seçimi, adres/telefon kutucukları;
yönetici görür, yalnız sahip değiştirir). `/salonlar` > il > ilçe > salon kartları (Randevu al), boş durum, sayfalama,
`noindex`. Platform paneli > "Salon rehberi". Salon sayfasında (yalnız uygulamada) "Salon bul" bağlantısı. Hesap silme
kartında "yalnızca bu salon" açıklaması.

**Uygulama (`mobile/`, mağaza sürümü gerektirir):** başlangıç ekranında "Şehir ve ilçeye göre salon bul"; "Salonlarım"
(ad + logo, ilk satır "Son salonum", × ile cihazdan kaldırma); rehberden açılan salon yerel ekran üzerinden açılır, böylece
listeye eklenir ve sonraki açılışta o salon gelir; "Salon değiştir" salon adını/logosunu yerel ekrana taşır (yalnızca
o salonun `/r/<kod>/marka/<id>` adresi kabul edilir). QR: her 4 karede bir ters renkli QR denemesi, Pro Güzellik'e ait
olmayan QR için uyarı, uygulama arka plana geçince kamera kapanır, izin reddi için Ayarlar yönlendirmesi.
Sayfa güvenlik politikası logolar için yalnızca site kökenine izin verir (derlemede yazılır).

**Testler (yerel):** API rehber testleri 12/12; ilgili takımlar (portal, rls, pwa-branding, demo-salon,
public-booking, platform-tenants) 89/89. Mobil 9/9. Web tip denetimi ve üretim derlemesi temiz. Tarayıcıda (telefon
boyutu) denendi: panel kartı kaydetme ve önizleme, `/salonlar` il/ilçe/salon sayfaları, başlangıç ekranı Salonlarım,
kaldırma, rehbere geçiş. **Denenmedi:** gerçek telefonda uygulama içi akışlar ve QR (Capacitor köprüsü tarayıcıda yok).

**Paralel çalışma notu:** testler artık `PG_TEST_DB=proguzellik_test_<ad>` ile ayrı veritabanında çalıştırılabilir;
başka bir klasörde aynı anda test koşan iş (Instagram) ortak `proguzellik_test` veritabanını sıfırlıyordu.

### Salon tam adresi, mahalle ve yol tarifi (16.11.2026 isteği)
- **Mahalle (tüm salonlar):** `Tenant.neighborhood` (serbest metin, en fazla 80 karakter; resmî mahalle listesi
  kullanılmadı). Ayarlar > İşletme bilgileri'nde "Açık adres" ve "Mahalle" alanları. Gerçek salonların adresi
  doldurulmaz; işletme kendisi girer. Rehber kartı eksik açık adres/mahalle için uyarı gösterir.
- **Tam adres:** açık adres + mahalle + ilçe / il (`src/directory/address.ts`). İl/ilçe rehber kartından gelir; salon
  sayfası (`/r/<kod>`), rehber (yalnız "adresim görünsün" açıksa) ve yapay zekâ asistanının salon bilgisi bunu kullanır.
- **Yol tarifi al:** `SalonListing.showDirections`, varsayılan kapalı. Açıksa salon sayfasında, rehberde ise yalnızca
  adres de gösteriliyorsa adres metniyle Google Haritalar araması açılır. Konum izni, koordinat ve sunucudan harita
  servisine istek yoktur; mağaza beyanları değişmez. Uygulamada bağlantı Capacitor tarafından uygulama dışında açılır
  (Android `Bridge.launchIntent`, iOS `WebViewDelegationHandler`: izinli alan dışı gezinme).
- **Migration:** `20261116130000_salon_address` (yalnızca ekleme; `Tenant` için sütun düzeyinde `UPDATE ("neighborhood")`
  izni). Demo salon: mahalle "Kirişçi Mahallesi" (açık adres metni değişmedi), yol tarifi kapalı.
- **Testler:** rehber 15/15 (rol üzerinden mahalle kaydı, başka salona yazamama, yol tarifi kuralları).

### Canlıya alma (her adım ayrı onayla)
1. Sunucu yedeği + geri yükleme doğrulaması, ardından web+API yeni sürüm ve `20261116120000_salon_listing`
   migration'ı (yalnızca ekleme). Duman testi: `/salonlar` 200 ve noindex, `/public/directory/provinces` boş liste,
   mevcut `/r/demo-salon` çalışıyor.
2. Demo salonun panelinden il/ilçe seçip listelemeyi açmak (inceleme ekibi rehberde bir salon görsün). Hangi il/ilçe
   seçileceği sizin kararınız; demo salonun gerçek adresi yok.
3. Mobil 1.1.0: `node scripts/set-version.mjs 1.1.0 && npm run sync`, Android imzalı `.aab` → Play dahili test →
   gerçek telefonda QR ve rehber denemesi → üretim; iOS için Apple hesabı hazır olunca doğrudan 1.1.0. 1.0.0 Play onayı
   gelmeden 1.1 gönderilmez.
