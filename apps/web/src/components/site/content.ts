/**
 * Tanıtım sitesi metinleri. Yalnızca uygulamada bulunan özellikler anlatılır;
 * dış hesap gerektirenler (WhatsApp) açıkça belirtilir. Rakam, müşteri yorumu veya istatistik yoktur.
 */
export type FeatureSection = { slug: string; title: string; short: string; intro: string; metaDescription: string; items: { title: string; text: string }[]; note?: string };

export const FEATURES: FeatureSection[] = [
  {
    slug: "randevu-musteri",
    title: "Randevu ve müşteri yönetimi",
    short: "Personel bazlı takvim, online rezervasyon ve müşteri kartı.",
    intro: "Randevularınızı personel, hizmet ve süreye göre planlayın; müşterinizin geçmişini tek kartta görün.",
    metaDescription: "Güzellik salonları için personel bazlı randevu takvimi, çakışma kontrolü, online rezervasyon sayfası ve müşteri kartı.",
    items: [
      { title: "Gün, hafta ve ay görünümü", text: "Takvimde personellere göre sütunlar; randevu oluşturma, taşıma, iptal ve durum güncelleme." },
      { title: "Çalışma saatleri ve izinler", text: "Her personel için çalışma saatleri ve izin günleri tanımlanır; uygun olmayan saate randevu verilmez." },
      { title: "Çakışma kontrolü", text: "Aynı personele aynı saatte ikinci randevu kaydedilemez." },
      { title: "Online rezervasyon sayfası", text: "Müşterileriniz salonunuza özel bağlantıdan hizmet, gün ve saat seçerek randevu alır ve iptal edebilir." },
      { title: "Müşteri kartı", text: "İletişim bilgileri, randevu ve işlem geçmişi, notlar, etiketler ve paket bakiyeleri tek yerde." },
      { title: "KVKK araçları", text: "Onay kayıtları tutulur; müşteri verisi dışa aktarılabilir ve anonimleştirilebilir." },
    ],
    note: "WhatsApp onay ve hatırlatma mesajları, işletmenin WhatsApp Business (Cloud API) hesabı bağlandığında gönderilir.",
  },
  {
    slug: "personel-prim",
    title: "Personel, yetki ve prim",
    short: "Rol bazlı yetkiler, güvenli ekip daveti ve prim hesabı.",
    intro: "Ekibinizi davet edin, herkes yalnızca yetkisi olan ekranları görsün; primler kayıtlardan hesaplansın.",
    metaDescription: "Salon personeli için rol bazlı yetkiler, e-posta ile güvenli davet, iki adımlı doğrulama ve personel prim takibi.",
    items: [
      { title: "Rol bazlı yetkiler", text: "İşletme sahibi, yönetici, resepsiyon ve personel rolleri; kasa ve ayarlar gibi ekranlar yetkiye göre açılır." },
      { title: "Güvenli ekip daveti", text: "Ekip üyeleri e-posta ile davet edilir ve parolasını kendisi belirler; geçici parola paylaşılmaz." },
      { title: "Personel kartları", text: "Verdiği hizmetler, çalışma saatleri ve izinler personel bazında tutulur." },
      { title: "Prim takibi", text: "Personel başına prim oranı tanımlanır; tamamlanan işlemlere göre prim tutarları raporlanır." },
      { title: "Hesap güvenliği", text: "İki adımlı doğrulama (TOTP), oturum listesi ve uzaktan oturum kapatma." },
    ],
  },
  {
    slug: "stok-finans",
    title: "Stok, kasa ve paketler",
    short: "Tahsilat, gider, iade, seanslı paketler ve stok hareketleri.",
    intro: "Kasanızı, seanslı paketlerinizi ve ürün stoklarınızı aynı sistemde, birbirine bağlı olarak takip edin.",
    metaDescription: "Güzellik salonu kasa takibi, tahsilat ve iade, seanslı paket satışı, ürün ve sarf malzemesi stok yönetimi.",
    items: [
      { title: "Kasa", text: "Gelir, gider, kısmi tahsilat ve iade kayıtları; ödeme yöntemine göre ayrım." },
      { title: "Paket ve seans", text: "Lazer, cilt bakımı gibi seanslı paketler satılır; kullanılan ve kalan seanslar müşteri kartında görünür." },
      { title: "Ürün satışı", text: "Perakende ürün satışı kasaya ve stoğa birlikte işlenir." },
      { title: "Stok hareketleri", text: "Giriş, çıkış, düzeltme, satış ve sarf hareketleri geçmişiyle tutulur; kritik stok seviyesi izlenir." },
      { title: "Sarf malzemesi", text: "Hizmetlere bağlanan sarf malzemeleri işlem yapıldığında stoktan düşülür." },
    ],
  },
  {
    slug: "raporlar",
    title: "Raporlar ve işletme asistanı",
    short: "Ciro, randevu ve personel performansı raporları.",
    intro: "İşletmenizin durumunu günlük ciro, randevu ve personel bazında izleyin.",
    metaDescription: "Güzellik salonu raporları: günlük ciro, randevu durumu, personel performansı ve işletme asistanı önerileri.",
    items: [
      { title: "Gösterge paneli", text: "Bugünün randevuları, tahsilatlar ve öne çıkan bilgiler ilk ekranda." },
      { title: "Ciro raporları", text: "Seçtiğiniz tarih aralığı için günlük ciro, gelir ve gider toplamları." },
      { title: "Personel raporları", text: "Personel bazında tamamlanan işlemler ve prim tutarları." },
      { title: "İşletme asistanı", text: "Son 30 günün toplu verilerine (kişisel bilgi içermeden) bakarak öneriler sunar. Paketinize göre açılır." },
    ],
  },
];

export const FAQ: { q: string; a: string }[] = [
  { q: "Ücretsiz deneme nasıl başlar?", a: "Formu doldurduktan sonra e-posta adresinize doğrulama bağlantısı gelir. Bağlantıyı onayladığınızda hesabınız açılır ve 14 günlük deneme süreniz o anda başlar. Kredi kartı veya ödeme bilgisi istenmez." },
  { q: "Deneme süresi bitince verilerim silinir mi?", a: "Hayır. Deneme bittiğinde hesabınız salt okunur hâle gelir; verileriniz korunur. Ücretli paket tanımlandığında kaldığınız yerden devam edersiniz." },
  { q: "Ücretli pakete nasıl geçerim?", a: "Panelinizdeki Abonelik sayfasından paketleri inceleyebilir, bize e-posta ile ulaşarak paketinizi tanımlatabilirsiniz." },
  { q: "Kaç personel ekleyebilirim?", a: "Her paketin personel sınırı Fiyatlar sayfasında yazar. Sınırı aşarsanız yeni personel eklenemez; paketinizi yükseltebilirsiniz." },
  { q: "Telefondan kullanabilir miyim?", a: "Evet. Panel telefon, tablet ve bilgisayar tarayıcısında çalışır ve ana ekrana uygulama gibi eklenebilir." },
  { q: "Müşterilerim online randevu alabilir mi?", a: "Evet. Salonunuza özel rezervasyon sayfasından müşterileriniz uygun saatleri görerek randevu alır." },
  { q: "WhatsApp mesajları nasıl gönderilir?", a: "Onay ve hatırlatma mesajları için işletmenizin WhatsApp Business (Cloud API) hesabının bağlanması gerekir. Bağlantı yapılmadan mesaj gönderilmez." },
  { q: "Verilerim güvende mi?", a: "Her işletmenin verisi veritabanı düzeyinde ayrılır; başka bir işletme sizin verinizi göremez. İki adımlı doğrulama, oturum yönetimi ve işlem kayıtları bulunur." },
  { q: "Ekibim kendi hesabıyla mı girer?", a: "Evet. Ekip üyelerini e-posta ile davet edersiniz; her biri kendi parolasını belirler ve yalnızca rolüne uygun ekranları görür." },
];
