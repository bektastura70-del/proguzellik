# Yenilenme hatırlatması

Hizmetin tekrar süresi dolmadan (ör. saç boyama 45 gün) müşteriye önceden "yenileme zamanınız yaklaşıyor" hatırlatması gönderilir. Salon panelinde yenilemesi yaklaşan müşteriler listelenir. WhatsApp kullanılmaz. SMS sağlayıcısı yoktur ve eklenmedi.

**Durum (05.11.2026):** Yalnızca yerelde. Canlıya alınmadı. Gerçek alıcıya mesaj gönderilmedi.

**Geliştirme veritabanına migration uygulanmadı** (yalnızca test ve E2E veritabanlarında denendi). Bu yüzden yerelde API, `proguzellik` veritabanıyla başlatılırsa müşteri/hizmet/işletme sorguları "sütun yok" hatası verir. Yedek + geri yükleme doğrulaması + `npx prisma migrate deploy` onay bekliyor.

## Nasıl çalışır

| Adım | Ayrıntı |
|---|---|
| 1. Hizmet ayarı | Hizmetler → "Tekrar süresi (gün)" (mevcut `rebookAfterDays`) + yeni "Kaç gün önce hatırlatılsın" (`renewalRemindDaysBefore`, 1–60, tekrar süresinden kısa). |
| 2. Hesap | Yenileme günü = son **tamamlanan** işlemin günü (işletme saat dilimi) + tekrar süresi. Hatırlatma günü = yenileme günü − N. |
| 3. Planlama | Günlük gece görevi (`runDaily`) hatırlatma günü gelmiş müşteriler için bildirim kaydı açar, gönderim yerel saatle 11:00'dedir. Görev bir gün çalışmazsa yenileme gününe kadar telafi edilir. Yenileme günü geldiyse gönderilmez. |
| 4. Kanallar | **E-posta** (müşteride e-posta varsa) ve **uygulama bildirimi** (Web Push: salon uygulamasına aynı e-postayla giriş yapmış ve bildirimleri açmışsa, "Hatırlatmalar" tercihi açıksa). Bildirim metninde müşteri adı ve hizmet adı yoktur (kilit ekranı). |
| 5. Gönderim anı | Mevcut BullMQ kuyruğu ve işçisi kullanılır (5 deneme, artan bekleme). Gönderimden hemen önce her koşul yeniden denetlenir. |

**Gönderilmez (planlanmaz ya da gönderim anında SKIPPED olur, nedeni kayda yazılır):**
- Ortam anahtarı veya işletme ayarı kapalıysa.
- Müşterinin ticari ileti izni (`marketingConsent`) yoksa.
- Müşteri hatırlatmaları kapattıysa.
- Müşteri anonimleştirildiyse.
- Müşterinin aynı hizmet için ileri tarihli randevusu varsa, ya da bu arada daha yeni bir işlem yapıldıysa.
- Hizmet pasife alındıysa ya da gün ayarları silindiyse.
- Kaynak işlem artık "tamamlandı" değilse.
- Yenileme günü geldiyse.

**Mükerrer engeli:** Her bildirim için `yenile:<son işlem>:<kanal>` benzersiz anahtarı kullanılır. Gece görevi tekrar çalışsa da ikinci kayıt açılmaz. Gönderilmiş kayıt yeniden işlenmez.

**Eski WhatsApp "tekrar randevu" mesajı:** Yenilenme hatırlatması açık olan işletmede, süre dolduktan sonra giden eski WhatsApp mesajı planlanmaz. Böylece müşteri iki kez rahatsız edilmez. Özellik kapalıyken eski davranış aynen sürer.

## Açma / kapama (varsayılan KAPALI)

Üç kat birlikte açık olmalı:

1. **Ortam:** `RENEWAL_REMINDERS=1` (api + worker). Tanımsızsa her ortamda kapalıdır.
2. **SaaS sahibi izni (pilot):** /platform → salon → "Yenilenme hatırlatması (pilot)" → gerekçe yazıp "İzin ver" (`renewalRemindersAllowed`). Varsayılan hiçbir salonda izin yoktur. Değişiklik `platform.renewal_reminders_allowed_changed` olarak denetim kaydına yazılır. İzin geri alınınca salonun kendi ayarı da kapanır ve bekleyen hatırlatmalar gönderilmez.
   - İzin yoksa salon panelinde menü ve ayar görünmez, `/renewals` 404 döner, işletme ayarı açılamaz (409). Salon bu izni kendisi değiştiremez (veritabanı yetkisi yok).
3. **İşletme:** Ayarlar → "Yenilenme hatırlatması" (sahip/yönetici). Varsayılan kapalıdır. Her değişiklik `tenant.renewal_reminders_changed` olarak denetim kaydına yazılır.

## Salon paneli

- **Yaklaşan yenilemeler** (`/panel/yenilemeler`; sahip, yönetici, resepsiyon):
  - Önümüzdeki 7/14/30/60 gün ve son 30 günde süresi geçenler listelenir.
  - Her satırda hatırlatma durumu gösterilir: Gönderildi, Bugün gönderilecek, Hatırlatma günü bekleniyor, Randevusu var, İleti izni yok (arayın), Hatırlatma istemiyor, Süre doldu (arayın).
  - **Ara** düğmesi `tel:` bağlantısıdır. **Randevu** düğmesi takvimde yeni randevu penceresini müşteri ve hizmet seçili olarak açar.
  - Liste, işletme ayarı kapalıyken de görünür (yalnızca ortam anahtarı açık olmalı).
- **Müşteri formu:** "Yenileme hatırlatması istemiyor" seçeneği. Müşteri telefonda isterse resepsiyon kapatır. İzin ve vazgeçme değişiklikleri `customer.consent_changed` olarak denetim kaydına yazılır (kim, ne zaman, önce/sonra).

## İzin ve vazgeçme (İYS / KVKK)

- Kod **en sıkı yorumu** uygular: hatırlatma ticari elektronik ileti sayılır. Yalnızca `marketingConsent` açık müşterilere gider ve gönderim anında yeniden kontrol edilir.
  - Bunun sonucu: online randevuda kampanya iznini işaretlemeyen müşteriler hatırlatma almaz. Panel listesinde "İleti izni yok, arayın" olarak görünürler.
- Her e-postada **vazgeçme bağlantısı** vardır: `/r/<salon>/hatirlatma-kapat?t=…`.
  - Bağlantı, o müşteri ve işletme için HMAC ile imzalıdır.
  - Sayfayı açmak hiçbir şeyi değiştirmez (e-posta tarayıcıları bağlantıyı önceden açabilir). Kapatma, düğmeye basınca olur.
  - Kapatılınca e-posta ve uygulama bildirimi ikisi de durur. Randevu bildirimleri etkilenmez.
- E-posta metni yalnızca işlevsel bilgi içerir (salon adı, hizmet, tarih, randevu ve vazgeçme bağlantısı). Yasal metin yazılmadı.
- **Hukuki teyit gerekiyor (karar Bektaş'ta):**
  1. Bu hatırlatma ticari ileti midir? Yoksa mevcut müşteriye hizmetle ilgili hatırlatma olarak önceden onay istisnasına girer mi?
  2. İşletmelerin İYS kaydı ve İYS'ye izin sorgusu gerekir mi? Kodda İYS entegrasyonu yoktur.
  3. E-postada gönderen kimliği için (işletme unvanı, iletişim) ek bilgi zorunlu mu?
  4. KVKK aydınlatma metninde bu işleme amacı yer alıyor mu?

  Hukuki görüş daha gevşek bir kural izin verirse bu, koşulun tek yerden (`renewal-checks.ts` ve `renewal.service.ts` içindeki `consentOk`) değiştirilmesiyle yapılır. O zamana kadar sıkı kural kalmalıdır.

## Teknik özet

- Migration'lar `20261105160000_renewal_reminders` ve `20261106090000_renewal_pilot` (`Tenant.renewalRemindersAllowed`, varsayılan false). Yalnızca sütun ekler, yeni tablo yoktur, RLS politikaları aynen geçerlidir:
  - `Tenant.renewalRemindersEnabled` (varsayılan false; `app_tenant`'a sütun bazlı UPDATE yetkisi verildi).
  - `Customer.renewalRemindersOptOutAt`.
  - `Service.renewalRemindDaysBefore` (CHECK 1–60).
- Kod dosyaları:
  - `apps/api/src/notifications/renewal.service.ts`: planlama, liste, vazgeçme.
  - `renewal-checks.ts`: gönderim anı denetimleri, e-posta değişkenleri, imza.
  - `renewals.controller.ts`: `GET /renewals`, `POST /public/renewal-reminders/opt-out`.
  - `notification-queue.ts`: EMAIL kanalı.
- E-posta: yeni şablon `renewal_reminder` (düzenlenemez, `secret`), mevcut `EmailService` ve `OutboundEmail` kaydı kullanılır.
  - Şablon değişkenleri (vazgeçme belirteci dahil) e-posta kaydında saklanmaz ve SaaS sahibinin e-posta merkezinden **elle yeniden gönderilemez**. Yeniden deneme yalnızca kuyruktan yapılır; orada izin, vazgeçme, randevu ve tarih her denemede yeniden kontrol edilir.
  - SMTP yoksa bildirim SKIPPED olur, sahte "gönderildi" yazılmaz.
  - Geçici SMTP hatası yeniden denenir, son denemede FAILED olur.
- Bildirim kayıtları `kind: MARKETING` ve `appointmentId` boştur (kaynak randevu tamamlandığı için randevu kontrolüne takılmasın diye).
- Testler:
  - API: `test/renewal.e2e.spec.ts` (11 test). Tüm API: 480/480.
  - Tarayıcı: `apps/e2e/tests/renewal.spec.ts`. E2E ortamında `RENEWAL_REMINDERS=1` her teste açıktır; tüm tarayıcı testleri 190/190 geçti (26 atlanan ekran görüntüsü testi).
- Bu testlerde e-posta ve push **test sağlayıcısıyla** çalışır, gerçek gönderim yoktur. Gerçek gönderim denemesi yalnızca onaylı bir test alıcısıyla yapılmalıdır (aşağıda).

## Canlıya alma planı (her adım ayrı onay ister, sunucu komutlarını Bektaş çalıştırır)

1. **Ön koşullar:**
   - Hukuki teyit (yukarıdaki 4 soru).
   - SMTP canlıda açık (açık).
   - Uygulama bildirimi isteniyorsa `WEB_PUSH_MODE=live` + VAPID ve PWA bayrakları. Bunlar yoksa yalnızca e-posta gider.
2. **Yedek:** `infra/production/backup.sh` → yedeği geçici veritabanına geri yükleyip doğrulama (mevcut betikler).
3. **İmaj:** Yeni amd64 api+web imajları → sunucuya yükle → `archive-image.sh <çalışan sürüm>`.
4. **Migration:**
   - `migrate.js status` ile bekleyenleri gör. Canlıda bu sürümden önceki bekleyen migration'lar da olabilir, liste birlikte incelenmeli.
   - `migrate deploy`. Yalnızca sütun ekler, mevcut veriye dokunmaz, eski sürümle uyumludur.
5. **Kod, özellik KAPALI:** `APP_VERSION` güncelle, `up -d api worker web`, duman testi. `RENEWAL_REMINDERS` tanımsız kaldığı için hiçbir davranış değişmez.
6. **Ortam anahtarını açma:** `RENEWAL_REMINDERS=1`. SaaS sahibi izni olmayan salonlarda hiçbir şey görünmez, yani bu adım tek başına hiçbir salonu etkilemez.
7. **Kontrollü deneme (pilot):**
   - /platform'dan yalnızca Deneme salonuna izin verilir, salonun Ayarlar sayfasından hatırlatma açılır. Test müşterisi Bektaş'ın onayladığı test e-postasıyla, kampanya izni işaretli olarak eklenir; geçmiş tarihli tamamlanmış işlem hazırlanır.
   - Gece görevi beklenir (ya da onayla zorla çalıştırılır). Gelen e-posta ve vazgeçme bağlantısı kontrol edilir.
8. **Açılış:** Pilot başarılıysa SaaS sahibi diğer salonlara izin verir; hatırlatmayı her salonun sahibi kendi ayarından açar.
9. **Geri dönüş:**
   - Tek salon için: /platform'dan izni geri al (kod ya da sunucu işlemi gerekmez).
   - Tümü için: `RENEWAL_REMINDERS` satırını silip `up -d api worker`. Bekleyen hatırlatmalar gönderim anında SKIPPED olur.
   - Gerekirse `rollback.sh <önceki sürüm>`. Migration geriye uyumludur, veritabanı geri alınmaz.
