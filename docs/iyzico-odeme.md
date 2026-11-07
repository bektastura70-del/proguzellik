# iyzico Abonelik ile online ödeme (sandbox sürümü)

Durum (07.11.2026): kod hazır, **yalnız iyzico sandbox (test) ortamında** çalışır. Canlıda (`NODE_ENV=production`) online ödeme kapalıdır; canlı anahtar, canlıya alma ve ilk gerçek tahsilat ayrı onayla yapılacaktır.

## Akış
1. Salon sahibi Panel → Abonelik → paket seç → aylık/yıllık seç → **Ödeme** sayfası (`/panel/abonelik/odeme`).
2. Fatura bilgileri (ad soyad, TCKN/VKN, cep, şehir, adres) iyzico'ya iletilir, bizde saklanmaz. Sözleşme onayı zorunlu.
3. API, onaylı fiyat sürümü + dönem için iyzico'da ürün ve **KDV dahil** ödeme planını bir kez açar (`IyzicoPlanLink`), denemesiz. Fiyatlar koda yazılmaz; `/platform` Paketler'de onaylanan fiyat sürümünden gelir.
4. iyzico ödeme formu sayfada açılır; kart bilgisi yalnız iyzico'da girilir.
5. iyzico tarayıcıyı `/api/odeme/iyzico/donus` adresine döndürür → API sonucu iyzico'dan sorgular, plan ve tutarı doğrular, aboneliği açar (`provider = iyzico`). Tutar farklıysa abonelik açılmaz, iyzico aboneliği iptal edilir.
6. Sonraki aylık/yıllık çekimleri iyzico yapar ve `/api/webhooks/iyzico` adresine bildirim gönderir. İmza (`X-IYZ-SIGNATURE-V3`) doğrulanır, durum yine iyzico API'sinden okunur, her çekim bir kez kaydedilir.
7. Günlük görev iyzico aboneliklerinde **asla çekim denemez**; yalnız iyzico'daki durumu okur. Dönem bitti ve ödeme yoksa abonelik "ödeme bekliyor" olur; ödeme süresi (grace) dolarsa iyzico aboneliği de iptal edilir.
8. Salon iptal ederse iyzico'da sonraki çekimler hemen durdurulur, erişim dönem sonuna kadar sürer.

## Sandbox kurulumu (yerel)
`apps/api/.env` (git'e girmez):
```
PAYMENT_MODE=iyzico
IYZICO_API_KEY=<sandbox API anahtarı>
IYZICO_SECRET_KEY=<sandbox güvenlik anahtarı>
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
IYZICO_MERCHANT_ID=<sandbox üye işyeri no>
```
Bildirim (webhook) testi için iyzico'nun ulaşabileceği bir adres gerekir (yerelde yoksa günlük görev durumu iyzico'dan okuyarak telafi eder). Bildirim imzası özelliğinin hesapta açılması için iyzico'ya (entegrasyon@iyzico.com) başvurulması gerekebilir.

## Bilinçli sınırlar (sonraki işler)
- Canlı iyzico adresi (`api.iyzipay.com`) bu sürümde reddedilir.
- Aktif abonelikte paket/dönem değişikliği (iyzico "upgrade") yok; salon bize ulaşır.
- Fiyat değişikliği mevcut iyzico abonelerine otomatik yansımaz (yeni sürüm yeni planla yeni satışlarda geçerli).
- Kart güncelleme formu yok.
- Resmî fatura (e-Fatura/e-Arşiv) entegratör bağlanınca kesilecek; şu an kesilmez.
- Mesafeli satış ve iade metinlerinin avukat kontrolü önerilir.
