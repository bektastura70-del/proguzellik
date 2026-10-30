# Pro Güzellik: tamamlama raporu (30.10.2026)

Her şey yerelde tamamlandı, test edildi ve commitlendi. Sunucuya, DNS'e ve canlı veritabanına dokunulmadı; dağıtım yapılmadı.

## 1. Tamamlanan modüller

| Aşama | İçerik |
|---|---|
| Canlıda ödeme güvenliği | `NODE_ENV=production` iken test ödeme sağlayıcısı kapalı; online ödeme 503, otomatik yenileme "ödendi" sayılmaz. İşletme yalnızca SaaS sahibinin manuel aboneliğiyle aktif olur ve bu abonelikler değiştirilemez bir defterde tutulur. |
| SaaS sahibi paneli (`/platform`) | Kullanıcı yönetimi, 2FA sıfırlama (sahibin parolası ve 2FA koduyla), ekip daveti, paket oluşturma, deneme uzatma, abonelik izleme. |
| SaaS sahibi muhasebesi | Cari hesap, tahakkuk, tahsilat/iade, fatura taslakları, gelir raporları. Salon muhasebesinden veritabanı yetkileriyle ayrılmıştır. |
| E-posta merkezi | Gönderim geçmişi, tekrar deneme, düzenlenebilir şablonlar, hizmet bilgilendirmesi, ödeme hatırlatma, deneme bitiş hatırlatmaları (7/3/1 gün). SMTP yoksa e-posta gönderilmez; kayıt "yapılandırılmadı" olarak tutulur. |
| 14 gün ücretsiz deneme | İşleyiş: başvuru, e-posta doğrulama, işletme oluşturma, 14 gün deneme. İşletme ve deneme yalnızca doğrulamadan sonra oluşur ve bağlantı tek kullanımlıktır. KVKK, koşul ve isteğe bağlı pazarlama onayları sürümüyle ve değiştirilemez şekilde kaydedilir. Kötüye kullanıma karşı: telefon tekrarı engeli, e-posta ve IP hız sınırı. Hesabın var olup olmadığı yanıttan anlaşılmaz. |
| Tek alan adı | `/` tanıtım sitesi, `/giris` ortak giriş, `/platform` yalnızca SaaS sahibi (sunucu tarafında kontrol), `/panel` salon uygulaması, `/ucretsiz-deneme` kayıt. Girişten sonra role göre yönlendirme yapılır; `/yonetim` adresi `/platform`'a yönlendirilir. |
| Tanıtım sitesi | Ana sayfa, özellikler (randevu/müşteri, personel/prim, stok/finans, raporlar), fiyatlar, SSS, iletişim, hakkımızda, KVKK, gizlilik, çerez politikası, kullanım koşulları. Fiyatlar veritabanındaki paketlerden gelir; sahte yorum veya istatistik yoktur. Sitede sitemap, robots, meta etiketleri ve mobil menü bulunur. |
| Son denetim | Kırık bağlantı yok; rol ve özellik korumaları ile salon finans hesapları kontrol edildi. **Düzeltilen hata:** oturum açıkken yanlış parola veya 2FA kodu girilince kullanıcı sistemden atılıyordu; artık hata formda gösteriliyor. |
| Dağıtım hazırlığı | SMTP için ayrı çıkış ağı. Ön kontroller: SMTP olmadan kayıt açılamaz. Canlı ortam değişkenleri ayarlandı. Kılavuza DNS, e-posta, deneme açma, canlıya alma onay listesi, yedek ve geri dönüş bölümleri eklendi (`docs/deployment.md`). |

## 2. Commitler (bu tur)
`9440653`, `0a3363f`, `7e987ca`, `9f7874b`, `cefec13`, `951b493`, `bd23dbf`, `0d7d074`, `46985c5`

## 3. Migration'lar (yalnızca yerel geliştirme veritabanına uygulandı; her birinden önce yedek alındı ve doğrulandı, veri sayıları değişmedi)
`20261030090000_manual_subscriptions`, `20261030120000_role_invites`, `20261030140000_plan_code_text`, `20261030160000_platform_finance`, `20261030180000_email_center`, `20261030200000_trial_signup`

Canlı veritabanı henüz kurulmadı; ilk kurulumda tüm migration'lar sırayla uygulanır.

## 4. Test sonuçları
- API: 22 dosya, **294/294 geçti**
- Tarayıcı (Playwright, masaüstü/tablet/mobil): **165 geçti, 0 başarısız** (25 atlanan yalnızca ekran görüntüsü üretimi)
- Web tip kontrolü temiz

## 5. Çalışmayan veya yapılandırma bekleyenler
- **SMTP / kurumsal e-posta:** sağlayıcı ve giriş bilgileri yok; MX/SPF/DKIM/DMARC kayıtları yok. Bu yüzden davet, doğrulama, parola sıfırlama ve hatırlatma e-postaları canlıda gitmez ve ücretsiz deneme kaydı açılamaz.
- **Online ödeme sağlayıcısı:** entegre değil, canlıda kapalı. Abonelikler manuel yönetilir.
- **e-Fatura / e-Arşiv entegratörü:** yok (`EINVOICE_PROVIDER=none`). Sistem resmi fatura kesmez; yalnızca taslak ve kayıt tutar.
- **Şirket bilgileri:** unvan, adres, telefon, IBAN, vergi bilgileri ve KDV oranı girilmedi (`/platform` → Muhasebe → Şirket bilgileri).
- **Fiyatların onayı:** paket fiyatları demo değerleridir.
- **Hukuki metinler:** KVKK, gizlilik, çerez metinleri ve onay ifadeleri avukat onayı bekliyor. Kullanım Koşulları sayfasındaki [KÖŞELİ PARANTEZ] alanları doldurulmalı.
- **WhatsApp:** Meta Business hesabı ve onaylı şablonlar yok.
- **Yerel not:** geliştirme veritabanında eski bir migration'ın kayıtlı özeti farklı olduğundan `pnpm db:migrate` sıfırlama öneriyor. Sıfırlama **yapılmamalı**; `npx prisma migrate deploy` kullanılmalı. Canlıyı etkilemez.

## 6. Canlıya alma adımları (her biri ayrı onayla)
1. Yerelde son derleme ve testler, ardından amd64 imajlar.
2. Sunucuda önce yedek: Caddyfile yedeği ve diğer projelerin durum kaydı. Diğer projelere dokunulmaz.
3. `first-install.sh` ile kurulum. Bu adımda kayıt kapalı, e-posta ve ödeme pasif kalır.
4. SaaS sahibi hesabı (sahip kendi terminalinde oluşturur) ve ilk girişte 2FA.
5. **DNS:** `@` ve `www` A kayıtları VPS'e yönlendirilir. **Onay gerekir.**
6. **Caddy:** blok eklenir, ardından `caddy validate` ve `caddy reload`. **Onay gerekir.**
7. Duman testi; sorun çıkarsa `rollback.sh` veya Caddy yedeğine dönülür.
8. SMTP bilgileri gelince e-posta DNS kayıtları girilir, `EMAIL_MODE=smtp` yapılır ve test e-postası gönderilir.
9. Hukuki metinler ve fiyatlar onaylanınca `REGISTRATION_ENABLED=1` yapılır, Caddy'deki kayıt engeli kaldırılır ve ücretsiz deneme açılır.

Ayrıntılı komutlar: `docs/deployment.md`, bölüm 10.
