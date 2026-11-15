# ProGüzellik — Kalite kontrol ve geliştirme raporu (27 Ekim 2026)

**Son commit:** bu raporu ekleyen commit (`git log -1`). Önceki kod commit'i: `de54b99`.

## Test sayıları
| Katman | Sayı | Sonuç |
| --- | --- | --- |
| API (Jest + Supertest, gerçek PostgreSQL + Redis) | 116 | 116 geçti |
| Tarayıcı (Playwright, sistem Chrome) | 118 çalıştırma (masaüstü 1440px, tablet 820px, mobil 390px) | 118 geçti |
| Typecheck + build (api, web, e2e) | 5 görev | Hatasız |

Tarayıcı testleri ayrı `proguzellik_e2e` veritabanında uydurma demo verisiyle çalışır. Her işlemden sonra kaydın API üzerinden veritabanında kalıcı olduğu ve sayfa yenilenince korunduğu ayrıca doğrulandı.

## Test edilen modüller
| Modül | Tarayıcıda doğrulananlar |
| --- | --- |
| Takvim | Gün/hafta/ay görünümü, URL'de kalıcılık, boş hücreden hızlı randevu, boş saat önerisi, çakışma hatası, sürükle-bırak taşıma, izin/blok ekleme-kaldırma, düzenle/ertele/fiyat, onay, tamamla + tahsilat, iptal sebebi, iptalleri göster |
| Müşteriler | Ekleme, arama, etiket filtresi, mükerrer telefon hatası, düzenleme, not, tahsilat, bakiye |
| KVKK | JSON dışa aktarma dosyasının içeriği, anonimleştirme (kişisel veri silinir, mali kayıt korunur) |
| Hizmetler / kategoriler | Ekleme, düzenleme, kategori yönetimi, kullanılan kategorinin silinememesi |
| Personel | Ekleme, hizmet atama, çalışma saatleri, Başlangıç paketinde 4. personelin engellenmesi |
| Paketler | Şablon oluşturma/düzenleme, satış + peşinat, müşteri bakiyesi |
| Kasa | Gelir/gider, CSV indirme, kısmi iade, fazla iadenin reddi, tam iade sonrası butonun kalkması, prim ödemesi |
| Stok | Ürün ekleme/düzenleme, giriş hareketi, hareket geçmişi, perakende satış → kasa geliri, yetersiz stok, kritik stok filtresi |
| Raporlar, bildirimler, asistan | Gerçek verili rapor, planlanan WhatsApp onay/hatırlatma ve "Gönderildi" durumu (test modu), yerel asistan yanıtı |
| Abonelik | Başarısız test ödemesi, başarılı aktivasyon, ödeme geçmişi |
| Ayarlar / ekip | İşletme bilgisi kalıcılığı, kullanıcı ekleme, geçici parolayla ilk girişte zorunlu parola değişimi |
| SaaS sahibi paneli | İstatistik/MRR, işletme listesi, askıya alma (işletme erişemez) ve geri açma, paket fiyatı |
| Online rezervasyon | Hizmet → gün → saat → bilgiler → onay → imzalı bağlantıyla iptal; KVKK onaysız gönderim engeli; kapalı işletme |
| Kayıt | Yeni işletme kaydı, 7 günlük deneme |
| Ekran düzeni | 15 panel sayfası ve 5 herkese açık sayfada üç ekran boyutunda yatay taşma yok; mobil menü; diyaloglar ekrana sığıyor |

## Güvenlik ve kiracı izolasyonu
- **RLS (API testleri):** `tenantId` taşıyan her tabloda RLS açık ve zorunlu (otomatik tarama); bağlam yokken satır görünmüyor; başka işletmeye okuma/yazma/güncelleme/silme engelli; parola özetleri uygulama rolüne kapalı.
- **Tarayıcıdan izolasyon:** başka işletmenin kimliği `X-Tenant-Id` ile gönderildiğinde 403; başka işletmenin müşteri kimliğiyle 404; liste yalnızca kendi verisi.
- **Roller:** Personel kasa/rapor/ayar/ekip uç noktalarına erişemiyor (menüde de yok); resepsiyon tahsilat alabiliyor, iade/gider yapamıyor.
- **Oturum:** Oturumsuz panel erişimi girişe yönleniyor; token httpOnly + SameSite=Lax çerezde; başka kökenden gelen durum değiştiren istek 403 (CSRF koruması); CSP, X-Frame-Options, nosniff başlıkları.
- **Finansal bütünlük:** Mali, stok ve denetim kayıtları değiştirilemez; eşzamanlı iade/satışta tutarsızlık yok; iade kalan tutarı aşamaz.
- **Personel limiti:** API'de ve arayüzde paket sınırı uygulanıyor; paket düşürme aktif personel sayısını aşamıyor.

## Tespit edilip düzeltilen hatalar
1. Form etiketleri giriş kutularına bağlı değildi (ekran okuyucu ve erişilebilirlik hatası).
2. Ana sayfa sunucuda çökerek açılmıyordu (istemci fonksiyonu sunucuda çağrılıyordu) — önceki turda bulundu, düzeltildi.
3. Mobilde rapor ve tablolu sayfalar ekrandan taşıyordu.
4. Davet edilen kullanıcı geçici parolayla süresiz çalışabiliyordu; artık ilk girişte parola değiştirmek zorunlu.
5. Giriş hız sınırı, istemcinin gönderdiği `X-Forwarded-For` başlığıyla atlatılabiliyordu; artık yalnızca güvenilir vekil arkasında kullanılıyor.
6. Durum değiştiren isteklerde köken kontrolü yoktu (CSRF için ek katman eklendi).
7. Benzersizlik ihlalleri (ör. aynı kategori adı) 500 hatası veriyordu; artık 409 ve anlaşılır mesaj.
8. Bekleyen randevusu olan personel pasife alınabiliyordu; artık engelleniyor.
9. Anonimleştirilen müşterinin bekleyen randevuları ve planlı mesajları duruyordu; artık iptal ediliyor.
10. Tamamen iade edilmiş kayıtta "İade" butonu görünüyordu ve hata veriyordu.
11. Birçok formda hata yakalanmadığı için işlem başarısız olduğunda kullanıcı bilgilendirilmiyordu.
12. Genel bakışta sunucu/istemci uyumsuzluğu (online bağlantı alanı).
13. Takvim sütunları ekranı doldurmuyordu, hafta görünümünde kartlar okunmuyordu.

## Eklenen özellikler
- Takvim: gün/hafta/ay, sürükle-bırak, çalışma saati gölgesi, izin/blok yönetimi, durum renkleri ve açıklaması, şimdi çizgisi, boş saat önerisi, personel filtresi, düzenle/ertele/fiyat değiştir, iptal sebebi, mobil ajanda görünümü.
- Zorunlu ve isteğe bağlı parola değiştirme sayfası.
- Hizmet kategorisi yönetimi; paket şablonu düzenleme/pasife alma; müşteri paketini iptal.
- Ürün düzenleme ve stok hareket geçmişi; tür ve kritik stok filtreleri.
- Kasa: tarih kısayolları, CSV dışa aktarma, iade edilen/kalan tutar.
- Müşteri etiket filtresi; genel bakışta hızlı işlemler ve online bağlantıyı kopyalama.
- Randevu ertelemelerinin denetim kaydı.

## Hâlâ eksik olanlar
- Gerçek ödeme sağlayıcısı (iyzico/PayTR) ve fatura/e-Arşiv entegrasyonu.
- Gerçek WhatsApp gönderimi için Meta hesabı, onaylı şablonlar ve anahtarlar (altyapı hazır, test modunda).
- Parola sıfırlama (e-posta/SMS), e-posta ile davet, iki adımlı doğrulama.
- Abonelik dönem sonu kontrolü için günlük zamanlanmış görev (şimdilik SaaS panelinden tetikleniyor).
- Hız sınırlayıcı bellek içi; birden fazla sunucuda Redis'e taşınmalı.
- Mobilde/dokunmatikte sürükle-bırak yok (taşıma "Düzenle / ertele" ile yapılıyor).
- Çok şubeli işletme, SMS kanalı, müşteri sadakat/puan, gelişmiş rapor dışa aktarma (PDF/Excel) yok.
- KVKK, gizlilik ve çerez metinleri şablon; hukuk incelemesi gerekli.
- Canlı ortam (sunucu, yedekleme, izleme, alan adı/SSL) kurulmadı.
