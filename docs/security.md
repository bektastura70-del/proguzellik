# Güvenlik ve KVKK notları

## Uygulanan önlemler
- Parolalar bcrypt (12 tur); 5 hatalı denemede 15 dk kilit; giriş/kayıt/rezervasyon için hız sınırı.
- Token tarayıcıda yalnızca httpOnly çerezde; API CORS yalnızca web kökenine açık.
- PostgreSQL RLS + uygulama düzeyi kontroller (iki katmanlı izolasyon), otomatik izolasyon testleri.
- Değiştirilemez mali, stok ve denetim kayıtları.
- KVKK: açık rıza zaman damgası, müşteri verisi dışa aktarma (JSON), anonimleştirme; yapay zekâya kişisel veri gönderilmez.
- WhatsApp webhook'u `X-Hub-Signature-256` HMAC imzası olmadan kabul edilmez.
- Online iptal bağlantıları HMAC imzalıdır.

## Kimlik doğrulama ve oturumlar
- Her giriş sunucu tarafında bir `Session` kaydı açar; JWT yalnızca oturum kimliği taşır. Çıkış, parola değişikliği/sıfırlama ve "diğer oturumları kapat" oturumları anında geçersiz kılar. Hareketsizlik süresi `SESSION_IDLE_MINUTES`, mutlak süre `SESSION_TTL_HOURS`.
- Parola sıfırlama: 256 bit rastgele, veritabanında yalnızca SHA-256 özeti, 30 dk, tek kullanımlık; yeni istek eskileri geçersiz kılar; yanıt hesabın varlığını belli etmez; e-posta ve IP başına hız sınırı.
- E-posta doğrulama: 48 saat geçerli tek kullanımlık bağlantı; doğrulanmadan abonelik ödemesi yapılamaz.
- TOTP 2FA (RFC 6238): gizli anahtar AES-256-GCM ile şifreli saklanır; aynı kod tekrar kullanılamaz; 10 tek kullanımlık kurtarma kodu (özetlenmiş); 5 hatalı denemede 15 dk kilit. SaaS yöneticileri için zorunlu; işletme sahibi isterse sahip ve yöneticiler için zorunlu kılar.

## Üretim öncesi yapılması gerekenler
- Hız sınırlayıcı bellek içidir; çok sunuculu kurulumda Redis'e taşınmalı. API, `X-Forwarded-For` başlığına yalnızca güvenilir vekil arkasında güvenmeli.
- Ekibe eklenen kullanıcıya geçici parola panelde gösterilir (ilk girişte değiştirmek zorunlu); e-posta daveti eklenebilir.
- Yasal metinler şablondur; hukuk incelemesi gerekir.
- Gizli değerler (JWT_SECRET, DB parolaları, WhatsApp/Anthropic anahtarları) bir gizli yönetim sistemiyle sağlanmalı.
