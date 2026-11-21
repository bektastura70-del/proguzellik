# iyzico Abonelik ile online ödeme

Durum (21.11.2026): **canlı**. Gerçek ödeme 09.11.2026'dan beri tüm salonlarda açık (`PAYMENT_MODE=iyzico`, `IYZICO_BASE_URL=https://api.iyzipay.com`, `IYZICO_PILOT_TENANTS=*`), siteden doğrudan satın alma açık (`PURCHASE_ENABLED=1`). 21.11 itibarıyla canlıda **hiç gerçek ödeme ve hiç iyzico bildirimi (webhook) yok**; tek kayıt 09.11 sandbox testi (`iyzico_sandbox`, gelir raporuna girmez).

Canlı işletim adımları için aşağıdaki **Canlı işletim rehberi** bölümüne bakın.

## Akış
1. Salon sahibi Panel → Abonelik → paket seç → aylık/yıllık seç → **Ödeme** sayfası (`/panel/abonelik/odeme`).
2. Fatura bilgileri (ad soyad, TCKN/VKN, cep, şehir, adres) iyzico'ya iletilir, bizde saklanmaz. Sözleşme onayı zorunlu.
3. API, onaylı fiyat sürümü + dönem için iyzico'da ürün ve **KDV dahil** ödeme planını bir kez açar (`IyzicoPlanLink`), denemesiz. Fiyatlar koda yazılmaz; `/platform` Paketler'de onaylanan fiyat sürümünden gelir.
4. iyzico ödeme formu sayfada açılır; kart bilgisi yalnız iyzico'da girilir.
5. iyzico tarayıcıyı `/api/odeme/iyzico/donus` adresine döndürür → API sonucu iyzico'dan sorgular, plan ve tutarı doğrular, aboneliği açar (`provider = iyzico`). Tutar farklıysa abonelik açılmaz, iyzico aboneliği iptal edilir.
6. Sonraki aylık/yıllık çekimleri iyzico yapar ve `/api/webhooks/iyzico` adresine bildirim gönderir. İmza (`X-IYZ-SIGNATURE-V3`) doğrulanır, durum yine iyzico API'sinden okunur, her çekim bir kez kaydedilir.
7. Günlük görev iyzico aboneliklerinde **asla çekim denemez**; yalnız iyzico'daki durumu okur. Dönem bitti ve ödeme yoksa abonelik "ödeme bekliyor" olur; ödeme süresi (grace) dolarsa iyzico aboneliği de iptal edilir.
8. Ödeme yapılıp dönüş gelmezse (sekme kapandı vb.) günlük görev ve ilk çekim bildirimi bekleyen oturumu iyzico'dan sorgulayıp aboneliği açar; bir saatten eski ödenmemiş oturum kapanır. iyzico'da açılıp bizde açılmayan her abonelik (tutar/plan uyuşmazlığı, başarısız ilk çekim, aynı anda ikinci ödeme) iyzico'da iptal edilir ve referansı saklanır.
9. Sözleşme onayı sunucuda denetim kaydına yazılır (`iyzico.checkout_started`, metin sürümüyle).
10. Salon iptal ederse iyzico'da sonraki çekimler hemen durdurulur, erişim dönem sonuna kadar sürer.
11. Yıllık paket, dönem başından itibaren 14 gün içinde iptal edilirse (Teslimat ve İade 1.1) denetim kaydına `iyzico.refund_due` yazılır ve SaaS sahibine "İade gerekiyor" e-postası gider (sipariş referansı ve tutarla). **Para iadesi otomatik yapılmaz**; aşağıdaki iade adımları uygulanır. Erişim kuralı değişmez (dönem sonuna kadar sürer).
12. Siteden satın almada ödeme alınıp hesap açılamazsa (e-posta/telefon çakışması) iyzico aboneliği iptal edilir, `purchase.conflict_refund_needed` yazılır ve "İade gerekiyor" e-postası gider.

## Sandbox kurulumu (yerel)
Önce yerel `/platform` → Paketler'de fiyat sürümlerini onaylayın (yerel veritabanında onaylı fiyat yoksa "Seç" düğmesi görünmez).

`apps/api/.env` (git'e girmez):
```
PAYMENT_MODE=iyzico
IYZICO_API_KEY=<sandbox API anahtarı>
IYZICO_SECRET_KEY=<sandbox güvenlik anahtarı>
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
IYZICO_MERCHANT_ID=<sandbox üye işyeri no>
```
Bildirim (webhook) testi için iyzico'nun ulaşabileceği bir adres gerekir (yerelde yoksa günlük görev durumu iyzico'dan okuyarak telafi eder). Bildirim imzası özelliğinin hesapta açılması için iyzico'ya (entegrasyon@iyzico.com) başvurulması gerekebilir.

## Sandbox deneme sonucu (09.11.2026)
- Akıllı paket, aylık, 3.600 TL (3.000 + %20 KDV), iyzico test kartıyla ödendi: abonelik açıldı, ödeme kaydı tek sefer, iyzico panelinde abonelik ACTIVE.
- iyzico ödeme formunda abonelik için "iyzico ile üyeliğimi başlat ve kartımı sakla" kutusu işaretlenmeden ödeme alınmıyor (iyzico kuralı).
- iyzico `.local` uzantılı e-postayı ve geçersiz cep numarasını reddeder (gerçek salonlarda sorun değil).
- Abonelik detayı gerçekte `data` içinde doğrudan geliyor (doküman `items` listesi gösteriyor); istemci ikisini de okuyor. Detayda bir sonraki dönem `WAITING` olarak hazır bekliyor.

## Canlı işletim rehberi

### 1. iyzico panelinde bir kez yapılacaklar (SaaS sahibi)
1. **Canlı** üye işyeri panelinde (sandbox değil) bildirim / webhook adresini `https://proguzellik.com/api/webhooks/iyzico` olarak girin. Sandbox panelinde girilen adres canlıya geçmez.
2. Abonelik bildirimlerinin **imzalı (X-IYZ-SIGNATURE-V3)** gönderilmesini canlı hesap için açtırın (sandbox'ta iyzico'nun e-postasıyla açılmıştı; canlı için entegrasyon@iyzico.com'a "canlı hesabımızda abonelik webhook'u ve V3 imzası açık mı" diye yazın). İmza yoksa her bildirim 403 ile reddedilir.
3. Yanlış adres/imza sessiz kalır: ilk aylık yenilemede (ilk gerçek satıştan ~30 gün sonra) bildirim gelmezse günlük görev (gece 00:00) durumu iyzico'dan okuyarak yenilemeyi yine yakalar; yalnız gecikir. Kontrol: `bash /opt/proguzellik/infra/production/check-payments.sh 40` çıktısındaki "iyzico bildirimleri" bölümü.

Not: İlk ödeme webhook'u test etmez (09.11 sandbox testinde ilk ödemede bildirim gelmedi; ilk bildirim yenilemede gelir). Canlıya sahte/imzalı deneme bildirimi gönderilmez.

### 2. Kontrollü ilk gerçek ödeme (önerilir)
1. SaaS sahibi kendi kartıyla, kendi ikinci e-postasıyla `/fiyatlar` → en ucuz **aylık** paketi satın alır (1.200 TL KDV dahil).
2. Sunucuda `bash /opt/proguzellik/infra/production/check-payments.sh 1`: ödeme formu COMPLETED, abonelik ACTIVE, tahsilat PAID `iyzico`, hata yok.
3. Yeni salonun panelinden Abonelik → iptal (iyzico'da sonraki çekim durur).
4. iyzico panelinden bu ödemeyi iade edin, ardından aşağıdaki "İade" adımlarıyla kaydı işaretleyin. Böylece iade süreci de bir kez denenmiş olur.

### 3. İade (her durumda elle)
Ne zaman: "İade gerekiyor" e-postası (yıllık 14 gün, satın alma çakışması), müşteri talebi, mükerrer ödeme.
1. iyzico **canlı** panelinde ilgili siparişi (e-postadaki sipariş referansı) bulun ve iade edin.
2. `/platform` → İşletmeler → ilgili işletme → Abonelik → **Tahsilatlar** tablosunda ödemenin yanındaki **İade edildi** düğmesi → açıklama yazın. Bu işlem para iadesi yapmaz; tahsilatı "İade edildi" yapar, gelir raporundan düşer, denetim kaydına `iyzico.payment_refunded` yazar.
3. Resmî belge: kesilmiş fatura varsa iade faturası/iptal mali müşavirle elle yapılır (e-Fatura entegratörü yok).
4. Hesap açılamadan alınan ödemede (`purchase.conflict_refund_needed`) tahsilat kaydı oluşmaz; yalnız 1. adım yapılır.

### 4. Fatura (geçici, elle)
`EINVOICE_PROVIDER=none`: sistem resmî fatura kesmez. Her PAID tahsilat için (check-payments.sh veya `/platform` gelir raporu) mali müşavir/muhasebe yazılımıyla elle e-Arşiv/e-Fatura kesilir. Entegratör seçilince ayrı iş.

### 5. Kapatma / geri dönüş
- Siteden satın almayı kapat: `bash /opt/proguzellik/infra/production/disable-purchase.sh`
- Canlı iyzico aboneliklerini iptal etmek gerekiyorsa **anahtarları silmeden önce** yapın (disable betiği anahtarları siler).

## Bilinçli sınırlar (sonraki işler)
- Aktif abonelikte paket/dönem değişikliği (iyzico "upgrade") yok; salon bize ulaşır.
- Fiyat değişikliği mevcut iyzico abonelerine otomatik yansımaz (yeni sürüm yeni planla yeni satışlarda geçerli).
- Kart güncelleme formu yok.
- İade iyzico API'si ile otomatik yapılmaz; iyzico panelinden elle yapılır, `/platform` Tahsilatlar'da "İade edildi" olarak işaretlenir. Kısmi iade işaretlenemez (tam iade varsayılır).
- Bildirim gerçek iyzico'dan yerel bilgisayara ulaşamaz; yerelde yalnız ilk ödeme ve günlük görev eşitlemesi denenebilir.
- Resmî fatura (e-Fatura/e-Arşiv) entegratör bağlanınca kesilecek; şu an kesilmez.
- Hukuki metinler 1.1 (avukat onayı 20.11.2026, Ön Bilgilendirme Formu ve ayrı onaylar) kod adc5f39'da; canlıya alınması ayrı yayınla (deploy-app-adc5f39.sh).
