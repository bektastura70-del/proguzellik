# Güvenlik ve KVKK notları

## Uygulanan önlemler
- Parolalar bcrypt (12 tur); 5 hatalı denemede 15 dk kilit; giriş/kayıt/rezervasyon için hız sınırı.
- Token tarayıcıda yalnızca httpOnly çerezde; API CORS yalnızca web kökenine açık.
- PostgreSQL RLS + uygulama düzeyi kontroller (iki katmanlı izolasyon), otomatik izolasyon testleri.
- Değiştirilemez mali, stok ve denetim kayıtları.
- KVKK: açık rıza zaman damgası, müşteri verisi dışa aktarma (JSON), anonimleştirme; yapay zekâya kişisel veri gönderilmez.
- WhatsApp webhook'u `X-Hub-Signature-256` HMAC imzası olmadan kabul edilmez.
- Online iptal bağlantıları HMAC imzalıdır.

## Üretim öncesi yapılması gerekenler
- Hız sınırlayıcı bellek içidir; çok sunuculu kurulumda Redis'e taşınmalı. API, `X-Forwarded-For` başlığına yalnızca güvenilir vekil arkasında güvenmeli.
- Ekibe eklenen kullanıcıya geçici parola panelde gösterilir; e-posta/SMS daveti ve "ilk girişte parola değiştir" akışı eklenmeli.
- Parola sıfırlama ve iki adımlı doğrulama yok.
- Abonelik yaşam döngüsü (`POST /platform/lifecycle/run`) için günlük zamanlanmış görev (BullMQ repeatable job veya cron) kurulmalı.
- Yasal metinler şablondur; hukuk incelemesi gerekir.
- Gizli değerler (JWT_SECRET, DB parolaları, WhatsApp/Anthropic anahtarları) bir gizli yönetim sistemiyle sağlanmalı.
