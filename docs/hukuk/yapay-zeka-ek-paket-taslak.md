# TASLAK: Yapay zekâ ek paketi satış koşulları (avukat incelemesi için)

> Bu metin Claude tarafından 22.11.2026'da hazırlanmış bir **taslaktır**. Hukuki uygunluğu değerlendirilmemiştir; avukat onayı olmadan sitede yayınlanmaz ve ek paket satışı açılmaz.
> Köşeli parantez içindeki **[AVUKAT: …]** notları karar verilmesi gereken noktalardır.
> Mevcut 1.1 metinleri (Mesafeli Satış Sözleşmesi, Ön Bilgilendirme Formu, Teslimat ve İade Şartları) yalnız abonelik paketini kapsıyor. Ek paket bunlardan ayrı, tek seferlik bir satış.

## A. Sistemin fiilen yaptığı (kod, 22.11.2026)

Metin bu davranışa göre yazıldı. Davranış değişirse metin de değişmeli.

**Kim alabilir:** Yalnız Akıllı paketteki işletmeler alabilir.

**Tutar:**
- İşletme KDV hariç bir tutar seçer: hazır tutarlar 250, 500, 1.000 ve 2.000 TL, ya da 250–10.000 TL arasında 50 TL'nin katı bir tutar.
- Ödeme ekranında KDV ve KDV dahil toplam gösterilir. KDV oranı Akıllı paketin onaylı fiyatındaki orandır.
- Tahsilat iyzico ile tek seferlik ve tek çekimdir; taksit ve otomatik yenileme yoktur.

**Ne alınır:**
- Ödenen KDV hariç tutarın yarısı kadar "yapay zekâ kullanım değeri" işletmenin ek bakiyesine yüklenir.
- İşletme bu değeri TL olarak görmez. Panelde yalnız yaklaşık bir yüzde ve "aylık hakkınızın yaklaşık … kadar ek kullanım" ifadesi görünür.
- Bu ifade aşağı yuvarlanır: 250 TL aylık hakkın yaklaşık çeyreği, 500 TL yaklaşık yarısı, 1.000 TL yaklaşık 1 katı, 2.000 TL yaklaşık 2 katıdır.

**Ne zaman ve nasıl kullanılır:**
- Değer, ödeme iyzico'da doğrulanır doğrulanmaz yüklenir. Bu "anında ifa"dır ve ödeme ekranında ayrıca onay alınır.
- Önce aylık hak kullanılır; aylık hak bitince ek bakiyeden düşülür.
- Yapay zekâ yanıtlarının gerçek maliyeti değişkendir. Bu yüzden ek bakiyenin kaç yanıta yeteceği garanti edilmez; metinler "yaklaşık" der.

**Geçerlilik:** Ek bakiye son alımdan itibaren 12 ay geçerlidir. Her yeni alım bu süreyi yeniden başlatır. Süre dolunca kalan bakiye silinir.

**Paket değişikliği:**
- Yapay zekâ yalnız Akıllı pakette ve aboneliği deneme ya da aktif durumda olan işletmede çalışır.
- İşletme Akıllı paketten çıkarsa ya da aboneliği sona ererse kalan ek bakiye kullanılamaz. Bakiye silinmez; işletme 12 aylık süre içinde Akıllı pakete dönerse yeniden kullanılır.
- [AVUKAT: paket düşürmede veya abonelik bitişinde kullanılamayan ek bakiyenin iadesi gerekir mi? Metne yazılmalı.]

**İade (Bektaş'ın 21.11 kararı):**
- Alımdan itibaren 14 gün içinde iptal istenirse yalnız kullanılmayan pay iade edilir.
- İade iyzico üzerinden ödemeyi yapan karta yapılır. İade oranında değer bakiyeden geri alınır.
- iyzico ödemeyi onaylayıp dolandırıcılık kontrolünde reddederse ücret aynı gün iptal edilir. İptal tutmazsa SaaS sahibi panelinde "iade gerekli" olarak görünür ve tam iade yapılır.

**Fatura:** e-Fatura entegrasyonu yok.
[AVUKAT/MALİ MÜŞAVİR: fatura, aboneliklerdeki gibi elle mi kesilecek? Bu madde metne yazılmalı.]

## B. Önerilen metin (taslak)

### 1. Konu
İşbu koşullar, Pro Güzellik Akıllı paketini kullanan Alıcı'nın proguzellik.com paneli üzerinden satın aldığı tek seferlik "Yapay zekâ ek paketi"nin satışına ilişkindir. Abonelik paketine ilişkin Mesafeli Satış Sözleşmesi ve Ön Bilgilendirme Formu, bu koşullarda düzenlenmeyen konularda geçerlidir.
[AVUKAT: ayrı sözleşme mi, mevcut sözleşmeye ek madde mi?]

### 2. Hizmetin niteliği
Ek paket, Alıcı'nın müşteri mesajlarına yapay zekâ ile verilen yanıtlar için aylık kullanım hakkına ek bir kullanım hakkı sağlar. Kullanım hakkı yanıtların sayısına, uzunluğuna ve içeriğine göre değişen oranda tükenir. Panelde gösterilen oran ve etkiler yaklaşık değerlerdir; belirli sayıda yanıt taahhüt edilmez.

### 3. Bedel ve ödeme
Alıcı'nın seçtiği KDV hariç tutar, KDV ve KDV dahil toplam ödeme tutarı ödeme öncesinde gösterilir. Ödeme kredi veya banka kartı ile, iyzico aracılığıyla, tek seferde tahsil edilir. Ek paket otomatik olarak yenilenmez.

### 4. İfa (teslim)
Ek kullanım hakkı, ödemenin doğrulanmasıyla birlikte Alıcı'nın hesabına derhâl tanımlanır. Alıcı, ödeme sırasında hizmetin hemen başlamasını açıkça onaylar.

### 5. Geçerlilik süresi
Ek kullanım hakkı son ek paket alımından itibaren 12 ay geçerlidir. Süre sonunda kullanılmayan kısım sona erer ve iade edilmez.
[AVUKAT: süre sonunda iade yapılmaması tüketici olmayan (tacir) alıcı için uygun mu? Alıcılar işletme.]

### 6. Cayma ve iade
Ek paket anında ifa edilen bir hizmettir.
[AVUKAT: Alıcı tacir olduğu için Mesafeli Sözleşmeler Yönetmeliği uygulanır mı? Uygulanırsa anında ifa onayıyla cayma hakkı istisnası (md. 15) geçerli mi?]
Bununla birlikte Satıcı, alımdan itibaren 14 gün içinde destek kanalından talep edilmesi hâlinde ek paketin kullanılmamış kısmına karşılık gelen bedeli, ödemenin yapıldığı karta iade eder. İade edilen orandaki kullanım hakkı hesaptan düşülür.

### 7. Fatura
[AVUKAT/MALİ MÜŞAVİR: fatura kesme yöntemi ve süresi.]

### 8. Kişisel veriler
Ödeme ve fatura bilgilerinin işlenmesine ilişkin bilgiler [KVKK Aydınlatma Metni](/kvkk)'nde yer alır. Kart bilgileri Pro Güzellik tarafından saklanmaz; ödeme iyzico tarafından işlenir.

## C. Onaydan sonra yapılacak teknik adımlar (Claude)

1. Metni `apps/web/src/content/legal/` altına koymak ve ödeme ekranındaki onay kutusunu bu metne bağlamak. `TOPUP_TERMS_VERSION` taslak değerinden kesin sürüme geçer.
2. Ön Bilgilendirme özetini ek paket ödeme sayfasında doldurmak (abonelik ödemesindeki gibi).
3. Yayın betiği yazmak:
   - Yeni sürüm ve `AI_TOPUP_ENABLED=1`.
   - iyzico canlı Ödeme Formu ön kontrolü.
   - Ödeme formunun açılmadığı duman testleri.
4. Bektaş'ın küçük tutarlı ilk gerçek alımı yapması ve aynı gün iptal ya da iade ile denemesi. Bu adım ayrıca onaylanır.
