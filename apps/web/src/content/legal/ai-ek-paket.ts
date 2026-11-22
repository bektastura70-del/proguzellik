// Yapay zekâ ek paketi satış koşulları. Claude taslağı (22.11.2026, docs/hukuk/yapay-zeka-ek-paket-taslak.md),
// Bektaş Tura'nın avukatı tarafından görülüp onaylandı (Bektaş Tura, 22.11.2026). Md. 6 (12 ay sonu), md. 7 (Akıllı'dan
// çıkışta iade yok) ve md. 8 (cayma hakkı yok) Bektaş Tura'nın 22.11.2026 cevaplarıyla yazıldı; avukatın yazılı teyidi istendi.
// Md. 9 (fatura): elle kesilir (Bektaş, 22.11.2026); metin onaylı Mesafeli Satış Sözleşmesi md. 6 ile aynı ifade.
// Metin değişirse apps/api/src/ai-quota/ai-topup.service.ts içindeki TOPUP_TERMS_VERSION da değiştirilir.
export const AI_TOPUP_TERMS_TITLE = "Yapay Zekâ Ek Paketi Satış Koşulları";

export const AI_TOPUP_TERMS_BODY = `Bu koşullar, ek paket satın alınmadan önce Alıcı'yı bilgilendirmek ve satışın şartlarını belirlemek için hazırlanmıştır. Satın almaya özel bilgiler (Alıcı, tutar, KDV ve toplam) ödeme sayfasında ödemeden önce gösterilir.

## 1. Taraflar

**Satıcı:** Pro Güzellik markasıyla hizmet veren BEKTAŞ TURA REKLAM MEDYA VE BİLGİ TEKNOLOJİLERİ LİMİTED ŞİRKETİ. Unvan, adres, vergi ve iletişim bilgileri bu sayfanın başındaki künyede yer alır.

**Alıcı:** Pro Güzellik Akıllı paketini kullanan ve ek paketi panel üzerinden satın alan işletme. Fatura bilgileri satın alma sırasında Alıcı tarafından beyan edilir.

## 2. Konu

İşbu koşullar, Alıcı'nın proguzellik.com paneli üzerinden satın aldığı tek seferlik "Yapay zekâ ek paketi"nin satışına ilişkindir. Abonelik paketine ilişkin [Mesafeli Satış Sözleşmesi](/mesafeli-satis-sozlesmesi) ve [Ön Bilgilendirme Formu](/on-bilgilendirme-formu), bu koşullarda düzenlenmeyen konularda geçerlidir.

## 3. Hizmetin niteliği

Ek paket, Alıcı'nın müşteri mesajlarına yapay zekâ ile verilen yanıtlar için aylık kullanım hakkına ek bir kullanım hakkı sağlar. Ek hak, aylık kullanım hakkı bittikten sonra kullanılır.

Kullanım hakkı; yanıtların sayısına, uzunluğuna ve içeriğine göre değişen oranda tükenir. Panelde gösterilen oran ve etkiler yaklaşık değerlerdir; belirli sayıda yanıt taahhüt edilmez.

Yapay zekâ yalnızca Akıllı pakette ve aboneliği deneme ya da aktif durumdaki işletmede çalışır.

## 4. Bedel ve ödeme

Alıcı'nın seçtiği KDV hariç tutar, KDV ve KDV dahil toplam ödeme tutarı ödeme öncesinde gösterilir. Ödeme kredi veya banka kartı ile, iyzico aracılığıyla, tek seferde ve taksitsiz tahsil edilir. Ek paket otomatik olarak yenilenmez.

## 5. İfa (teslim)

Ek kullanım hakkı, ödemenin doğrulanmasıyla birlikte Alıcı'nın hesabına derhâl tanımlanır. Alıcı, ödeme sırasında hizmetin hemen başlamasını açıkça onaylar.

## 6. Geçerlilik süresi

Ek kullanım hakkı son ek paket alımından itibaren 12 ay geçerlidir; her yeni alım bu süreyi yeniden başlatır.

12 ay dolduğunda Alıcı'nın Pro Güzellik aboneliği devam ediyorsa, kullanılmayan ek hak silinmez ve 12 ay daha geçerli kalır. 12 ay dolduğunda Alıcı'nın aboneliği iptal edilerek sona ermişse, kullanılmayan ek hak iade edilmeksizin silinir.

## 7. Paket değişikliği ve aboneliğin sona ermesi

Alıcı Akıllı paketten çıkarsa ya da aboneliği sona ererse kalan ek kullanım hakkı kullanılamaz ve bedeli iade edilmez. Hak 6. maddedeki koşullarla silinmediği sürece, Alıcı Akıllı pakete döndüğünde yeniden kullanılabilir.

## 8. Cayma ve iade

Ek paket, Alıcı'nın ödeme sırasındaki açık onayıyla derhâl ifa edilen bir hizmet olduğundan cayma hakkı bulunmamaktadır.

Bununla birlikte Satıcı, alımdan itibaren 14 gün içinde destek kanalından talep edilmesi hâlinde ek paketin kullanılmamış kısmına karşılık gelen bedeli, ödemenin yapıldığı karta iade eder. İade edilen orandaki kullanım hakkı hesaptan düşülür.

## 9. Fatura

Tahsil edilen ek paket bedeli için yürürlükteki vergi mevzuatına uygun şekilde, Alıcı'nın ödeme sırasında beyan ettiği fatura bilgileriyle fatura düzenlenir. Ayrıntılar [Faturalandırma ve Ödeme Belgeleri Politikası](/faturalandirma-politikasi)'nda yer alır.

## 10. Kişisel veriler

Ödeme ve fatura bilgilerinin işlenmesine ilişkin bilgiler [KVKK Aydınlatma Metni](/kvkk)'nde yer alır. Kart bilgileri Pro Güzellik tarafından saklanmaz; ödeme iyzico tarafından işlenir.
`;
