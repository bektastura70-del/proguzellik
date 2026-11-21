# Yapay zekâ kullanım hakkı ve ek paket: canlıya geçiş planı

Hazırlanma: 21.11.2026 · Dal: `claude/project-thread-oc91uw` · Hedef sürüm: `6c80311` (veya bu belgenin commit'i)
Canlıdaki sürüm: `4296795`. **Bu planın hiçbir adımı henüz uygulanmadı.** Her aşama ayrı onayla başlar (bölüm 9).

## 1. Bu sürümle canlıya ne gider

Canlı `4296795`'ten bu dala kadar olan her şey birlikte gider:

| Commit | İçerik | Not |
|---|---|---|
| adc5f39, dafe703 | Hukuki metinler 1.1, Ön Bilgilendirme Formu, ayrı ödeme onayları | 20.11'de onaylandı, henüz yayınlanmadı. Metinler **OpenAI** diyor. |
| 3fc2016, 7c7f571, d8f91b9 | iyzico iade süreci, panel etiketleri, plan hatası 502 | Migration yok |
| 0e77b7e … 6c80311 | Kullanım hakkı, maliyet tavanları, ek paket, günlük sınır e-postası, Finans sütunu | **Migration var**: `20261121150000_ai_quota` |
| 9116114, 10e64e7, 65b8f81, 31d3a04 | İzleme ve salt okunur kontrol betikleri | Sunucuda çalıştırılmadıkça etkisi yok |

`docker-compose.yml` bu sürümde **değişiyor**: api'ye yapay zekâ değişkenleri eklendi. Hepsinin varsayılanı güvenli: `ASSISTANT_AI_MODE=mock`, `AI_QUOTA_MODE=off`, `AI_GLOBAL_PAUSE=0`, `AI_TOPUP_ENABLED=0`.

## 2. Önce bilinmesi gereken engel: pilot listesi

Canlıda `AI_MODE=openai` açık. Yeni kodda gerçek yapay zekâ canlıda **yalnız `AI_PILOT_TENANTS` listesindeki salonlarda** çalışıyor.
Bu liste boş kalırsa deploy anında yapay zekâ yanıtları durur, mesajlar ekibe düşer.

Bu yüzden deploy ile aynı anda `.env`'e şu satır girmeli: `AI_PILOT_TENANTS=<şu an yapay zekâ açık salon(lar)ın adresi, ör. deneme>`.

## 3. .env değişiklikleri (aşama aşama)

Değerler sunucuda `.env`'e elle girilir. Hiçbir anahtar sohbete veya repoya yazılmaz.

**Aşama A: deploy günü, davranış değişmez.**
- `AI_PILOT_TENANTS=<pilot slug>`: zorunlu (bölüm 2).
- `AI_PRICE_USD_PER_MTOK=<girdi>,<çıktı>,<önbellek okuma>,<önbellek yazma>`: OpenAI modelinin **resmi fiyat sayfasından** girilir.
  Girilmezse maliyet 0 kaydedilir ve günlük $ tavanı çalışmaz. Fiyatı ben uydurmuyorum, siz OpenAI sayfasından alırsınız.
- `AI_QUOTA_MODE=off`: yalnız kullanım kaydedilir, hak düşülmez.
- `AI_TOPUP_ENABLED=0`: ek paket satışı kapalı.
- `ASSISTANT_AI_MODE=mock`

**Aşama B: gölge (shadow) pilot, 1–2 hafta.**
1. Önce SaaS sahibi panelinde Yapay zekâ sayfasından ayarları girin: USD/TL kuru, tampon 1,10, katsayı 3, ek paket oranı 0,5, salon günlük $ sınırı, konuşma token sınırı.
2. Ardından `AI_QUOTA_MODE=shadow` yapın.

Bu modda hak düşer, bar hareket eder, ama yanıt kesilmez. Gerçek maliyet ile düşülen tutar karşılaştırılır.

**Aşama C: uygulama (enforce).**
- `AI_QUOTA_MODE=enforce`: hak bitince yapay zekâ yanıt vermez, mesaj ekibe düşer.

**Aşama D: Claude Haiku'ya geçiş (ayrı karar, bölüm 6).**
- `AI_MODE=anthropic`
- `AI_MODEL=claude-haiku-5-5`
- `ANTHROPIC_API_KEY=<konsoldan>`
- İsteğe bağlı: `ASSISTANT_AI_MODE=anthropic`
- `AI_PRICE_USD_PER_MTOK` boşaltılır (Haiku fiyatı kodda tanımlı).
- Preflight anahtar biçimini, modeli ve çıkış ağını (`docker-compose.egress.yml`) denetler; eksikse uygulama açılmaz.

**Aşama E: ek paket satışı (ayrı karar).**
- `AI_TOPUP_ENABLED=1`
- Ayrıca `PAYMENT_MODE=iyzico` olmalı ve salon `IYZICO_PILOT_TENANTS` listesinde (uuid) bulunmalı.
- Önkoşul: satış ve iade metinleri avukat onaylı (bölüm 7).

**Acil durdurma (her aşamada):** `AI_GLOBAL_PAUSE=1` + api yeniden başlatma. Tüm yapay zekâ yanıtları durur.

## 4. Migration, yedek ve geri yükleme

Migration `20261121150000_ai_quota` **yalnız ekleme yapıyor**:
- 5 yeni tablo, RLS ile birlikte.
- `Plan.aiMonthlyCreditKurus` (varsayılan 0) ve `ChannelConnection.aiDataConsentProvider` sütunları.
- Mevcut yapay zekâ onayları `'openai'` olarak işaretlenir.
- Akıllı (SMART) paketin aylık hakkı 500 TL değer (50000 kuruş) yapılır.
- Mevcut hiçbir sütun veya satır silinmez.

Sıra:
1. `./backup.sh` ile tam yedek alınır.
2. **Geri yükleme testi**: yedek geçici bir veritabanına açılır, tablo ve satır sayıları karşılaştırılır. Test geçmezse durulur.
3. `prisma migrate status`: bekleyen tek migration `20261121150000_ai_quota` olmalı. Başka bir şey görünürse durulur.
4. `prisma migrate deploy`, ardından kontrol:
   - 5 tablo var mı.
   - SMART için `aiMonthlyCreditKurus = 50000` mı.
   - Onaylı kanal sayısı = `aiDataConsentProvider='openai'` sayısı mı.
   - `AiCreditLedger` tetikleyicisi var mı.

**Geri dönüş:**
- Yeni sütun ve tablolar eski sürümü bozmaz. Uygulama sorununda yalnız imaj geri alınır (`./rollback.sh 4296795`), veritabanına dokunulmaz.
- Veritabanına geri yükleme yalnız migration yarıda kalır ya da veri bozulursa yapılır. Bu adım ayrıca sorulur, çünkü yedekten sonraki yazılan veriyi kaybettirir.

## 5. Deploy betiği (`deploy-app-<sha>.sh`, henüz yazılmadı)

Önceki betiklerle aynı kalıp kullanılır. Farklar: bu sürümde migration var ve compose değişiyor.

1. Ön kontrol: çalışan sürüm `4296795` mı, disk yeri, imajlar yüklü mü. İmajlar Mac'te amd64 için derlenip `docker save | ssh` ile taşınır.
2. `backup.sh` ve geri yükleme testi.
3. `archive-image.sh`: eski imajlar saklanır.
4. `.env` ve `docker-compose.yml` zaman damgalı yedeklenir.
5. `.env`'e yalnız onaylanan satırlar eklenir: `APP_VERSION`, `AI_PILOT_TENANTS`, `AI_QUOTA_MODE=off`, `AI_TOPUP_ENABLED=0` ve varsa `AI_PRICE_USD_PER_MTOK`. Başka hiçbir ayara dokunulmaz.
6. `preflight.sh`: hata varsa durur.
7. `migrate status` beklenen migration'ı göstermeli. Ardından `migrate deploy` ve bölüm 4 kontrolleri.
8. `docker compose up -d api worker web`
9. Sağlık kontrolü: `/health/ready`, kapsayıcı durumları.
10. Duman testleri:
    - Ana sayfa ve hukuki sayfalar (1.1 metni).
    - Salon paneli açılır, Yapay zekâ kartı görünür.
    - `/platform` Yapay zekâ sekmesi ve Finans raporu çalışır.
    - Ek paket sayfası "satışta değil" der.
    - Pilot salonda bir test mesajına yapay zekâ yanıt verir ve `AiUsageEvent` kaydı oluşur.
11. Otomatik geri dönüş: 8. adımdan sonra bir şey başarısız olursa betik compose ve `.env` yedeklerini geri koyar ve `./rollback.sh 4296795` çalıştırır.
    Migration geri alınmaz; geriye uyumlu olduğu için gerek yok.

## 6. Anthropic API anahtarı ve harcama limiti (Aşama D için)

- **Anahtar:** console.anthropic.com'da bu proje için ayrı bir workspace açılır ve yalnız bu sunucuya özel bir API anahtarı üretilir.
  Anahtar yalnız sunucudaki `.env`'e girilir; sohbete, e-postaya veya repoya yazılmaz.
- **Harcama limiti:** aynı konsolda workspace için aylık harcama limiti konur. Bu, koddaki tavanların (salon günlük $ sınırı, konuşma token sınırı, kullanım hakkı) üstünde ikinci bir kilittir.
  Başlangıç için düşük bir tutar önerilir; pilotta görülen gerçek maliyete göre yükseltilir. Tutarı siz belirlersiniz.
  Limit dolarsa Anthropic istekleri reddeder ve mesajlar ekibe düşer.
- **Ödeme:** Anthropic konsolunda kart veya ön yüklemeli bakiye tanımlı olmalı. Bu adımı siz yaparsınız; ödeme bilgisi giremem.
- **Hukuki etki (önemli):**
  - Canlıya gidecek 1.1 metinleri yurt dışına aktarım için **OpenAI**'yi sayıyor, Anthropic'i çıkarmış.
  - Claude'a geçmeden önce KVKK ve Gizlilik metinlerinin Anthropic'i içerecek şekilde güncellenmesi ve avukatın onayı gerekir.
  - Kod, onayı sağlayıcıya bağlı tutuyor: eski OpenAI onayları Anthropic için geçersiz. Her salonun Kanallar sayfasından yeniden onay vermesi gerekir; onay vermeyen salonda yapay zekâ çalışmaz.
  - Bunun hukuken yeterli olduğunu ben söyleyemem; avukata danışılmalı.

## 7. Ek paket satışı için önkoşullar (Aşama E)

- Satış, cayma ve iade metinleri avukat onaylı olmalı. "14 gün içinde iptalde yalnız kullanılmayan pay iade" kararı avukata sorulacaktı.
- iyzico tek seferlik Ödeme Formu canlı hesapta açık olmalı. İlk gerçek alım küçük tutarla yapılıp iade edilerek denenebilir; bu ayrıca onaylanır.
- e-Fatura bu kapsamda yok. Ek paket satışı açılmadan önce fatura kesme yöntemi netleşmeli.

## 8. Bu sürümde kod tarafında tamamlananlar

- Günlük maliyet sınırı aşılınca SaaS sahiplerine e-posta gider: işletme başına günde bir, `/platform?sekme=yapay-zeka` bağlantısıyla.
- Finans raporunda "Yapay zekâ ek paket" sütunu: yalnız canlı ödemeler, iade düşülmüş, CSV'de de var.
- Compose ve preflight yeni değişkenleri biliyor.
- Testler 621/621 geçti, web derlemesi başarılı.

## 9. Ayrı onay gereken adımlar

Her biri ayrı "evet" ister. Biri onaylanınca diğerleri onaylanmış sayılmaz.

1. **Deploy + migration (Aşama A):** `4296795` → yeni sürüm. Hukuki metin 1.1 de yayına girer. Yedek ve geri yükleme testinden sonra migration çalışır.
2. **.env (Aşama A):** `AI_PILOT_TENANTS` (hangi salon?), `AI_PRICE_USD_PER_MTOK` (OpenAI resmi fiyatı), `AI_QUOTA_MODE=off`, `AI_TOPUP_ENABLED=0`.
3. **Gölge pilot (Aşama B):** panelden kur ve sınır ayarları girildikten sonra `AI_QUOTA_MODE=shadow`.
4. **Uygulama (Aşama C):** `AI_QUOTA_MODE=enforce`.
5. **Claude Haiku'ya geçiş (Aşama D):** Anthropic anahtarı ve harcama limiti sizde. Hukuki metin güncellemesi ve avukat onayı, ardından salonların yeniden onayı.
6. **Gerçek ücretlendirme, ek paket satışı (Aşama E):** `AI_TOPUP_ENABLED=1`. Avukat onaylı metinler ve e-Fatura çözümü gerekir.
