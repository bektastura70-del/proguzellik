# Dağıtım ve işletim kılavuzu

Bu belge ProGüzellik'i canlı ortama almak için gereken adımları anlatır. Depoda **canlıya dağıtım yapılmadı**; aşağıdaki adımlar hazırlıktır.

## 1. Mimari

```
İnternet ─ TLS (nginx / yük dengeleyici) ─┬─ web  (Next.js, :3000)  ── /api/p/* vekili ──┐
                                           └──────────────────────────────────────────────┴─ api (NestJS, :4000) ─┬─ PostgreSQL 16
                                                                                                                  └─ Redis 7 (BullMQ)
```

- Tarayıcı yalnızca web ile konuşur; API'ye istekler Next.js vekili üzerinden, httpOnly çerezdeki oturumla gider. API'yi internete açmanız gerekmez (Meta WhatsApp webhook'u hariç: yalnızca `/webhooks/whatsapp` yolunu açın).
- API süreci içinde iki BullMQ işçisi çalışır: WhatsApp bildirimleri ve günlük abonelik görevi. Birden fazla API örneğinde zamanlayıcı tektir (aynı kimlikle kaydedilir), görev `JobRun` kaydıyla aynı gün ikinci kez çalışmaz.

## 2. Veritabanı hazırlığı

1. PostgreSQL 16 kurun, `btree_gist` eklentisi kullanılabilir olsun.
2. Migration sahibi rolü (ör. `proguzellik_owner`) ve veritabanını oluşturun.
3. Migration'ları **yalnızca dağıtım adımında**, sahibi rolle çalıştırın:
   ```bash
   DATABASE_URL=postgresql://proguzellik_owner:***@db:5432/proguzellik pnpm --filter @proguzellik/api exec prisma migrate deploy
   ```
   Migration'lar `app_tenant` (RLS zorunlu) ve `app_platform` (BYPASSRLS) rollerini NOLOGIN olarak oluşturur.
4. Uygulama rollerine güçlü parolalarla giriş izni verin (`scripts/dev-db-roles.sql` yalnızca yereldir; canlıda kullanmayın):
   ```sql
   ALTER ROLE app_tenant LOGIN PASSWORD '<gizli-yönetimden>';
   ALTER ROLE app_platform LOGIN PASSWORD '<gizli-yönetimden>';
   ```
5. Uygulama süreçlerine `DATABASE_URL` **vermeyin**; yalnızca `APP_DATABASE_URL` ve `PLATFORM_DATABASE_URL`.

## 3. Ortam değişkenleri

Tam liste ve açıklamalar: `apps/api/.env.example`, `apps/web/.env.example`. Canlıda zorunlu olanlar:

| Değişken | Açıklama |
| --- | --- |
| `NODE_ENV=production` | Canlı kontrolleri ve güvenli çerezleri açar |
| `APP_DATABASE_URL`, `PLATFORM_DATABASE_URL` | Uygulama rolleri (geliştirme parolaları reddedilir) |
| `REDIS_URL` | Kuyruk ve zamanlayıcı |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `MFA_ENCRYPTION_KEY` | `openssl rand -hex 32`; **değiştirilirse mevcut 2FA kayıtları çözülemez**, gizli yönetimde yedekleyin |
| `WEB_ORIGIN`, `APP_URL` | `https://...` olmalı |
| `TRUST_PROXY=1` | Yalnızca güvenilir ters vekil arkasında; web tarafında da `TRUST_PROXY=1` |
| `MFA_ENFORCE_PLATFORM=1` | SaaS yöneticileri için 2FA zorunlu |
| `EMAIL_MODE=smtp`, `SMTP_URL`, `EMAIL_FROM` | Parola sıfırlama/doğrulama için gerçek e-posta |
| `REGISTRATION_ENABLED` | Herkese açık işletme kaydı. Tanımsızsa canlıda **kapalı**; açmak için `1` |
| `WHATSAPP_*`, `PAYMENT_MODE`, `AI_MODE` | Entegrasyonlar; varsayılanları test modudur |

Denetim: `pnpm --filter @proguzellik/api build && NODE_ENV=production pnpm --filter @proguzellik/api env:check`. `NODE_ENV=production` iken engelleyici hata varsa API **başlamaz**.

## 4. Derleme ve çalıştırma

Docker imajları (monorepo kökünden):
```bash
docker build -f apps/api/Dockerfile -t proguzellik-api .
docker build -f apps/web/Dockerfile -t proguzellik-web .
```
Docker olmadan: `pnpm install --frozen-lockfile && pnpm turbo run build`, ardından `node apps/api/dist/main.js` ve `pnpm --filter @proguzellik/web start`.

Migration API başlangıcında **çalışmaz**; imajdaki ayrı komutla yapılır: `node dist/cli/migrate.js status` (salt okunur) / `node dist/cli/migrate.js deploy --confirm` (yalnızca `DATABASE_URL` sahibi rolüyle; uygulama rolleriyle reddedilir).

İlk SaaS sahibi (demo verisi olmadan, tekrar çalıştırmaya dayanıklı): `node dist/cli/create-owner.js --email <e-posta> --name "<Ad Soyad>"`. Parola gizli istemle ya da stdin'den okunur, komut satırından kabul edilmez. Aynı e-postayla tekrar çalıştırmak hiçbir şeyi değiştirmez; başka bir sahip varsa `--additional` olmadan ikinci hesap açmaz; sıradan kullanıcının yetkisini yükseltmez.

Sürüm sırası: (1) yedek al → (2) migration → (3) API'yi güncelle → (4) web'i güncelle → (5) duman testi.

## 5. Sağlık kontrolleri

| Uç nokta | Amaç |
| --- | --- |
| `GET /health` | Canlılık (süreç ayakta mı). Yeniden başlatma kararı için. |
| `GET /health/ready` | Hazırlık: iki veritabanı rolü + Redis. 503 dönerse trafiği yönlendirmeyin. |

## 6. Zamanlanmış görevler

- Varsayılan: API içinde her gün 03:00 (İstanbul) `subscription-lifecycle` görevi (`JOBS_CRON`).
- Alternatif: harici cron/Kubernetes CronJob ile `node apps/api/dist/cli/run-daily.js` (API'de `JOBS_ENABLED=0`).
- Görev; deneme hatırlatması/bitişi, otomatik yenileme, ödeme gecikmesi (`BILLING_GRACE_DAYS`), iptal ve paket sınırı denetimi yapar. Tekrar çalıştırmaya dayanıklıdır; e-postalar `dedupeKey` ile, tahsilatlar idempotency anahtarıyla tekilleştirilir.
- SaaS panelinde son çalıştırmalar görünür; "Şimdi çalıştır" aynı gün ikinci kez çalışmaz (API'de `?force=true` ile zorlanabilir, yine de çift tahsilat olmaz).

## 7. Yedekleme ve geri yükleme

Betikler: `infra/scripts/` (yerel Docker veya `PGHOST` + yerel pg araçlarıyla çalışır).

| İşlem | Komut |
| --- | --- |
| Yedek al | `BACKUP_DIR=/guvenli/yedekler BACKUP_KEEP_DAYS=14 infra/scripts/backup.sh` |
| Yedeği doğrula | `infra/scripts/verify-backup.sh <dosya>` — geçici veritabanına yükler, satır sayılarını ve RLS'yi karşılaştırır, geçici veritabanını siler |
| Yeni veritabanına geri yükle | `infra/scripts/restore.sh <dosya> [hedef_db]` — varsayılan `proguzellik_restore_<zaman>`, var olanın üzerine yazmaz |
| Üzerine yaz (felaket kurtarma) | `CONFIRM_OVERWRITE=hedef_db infra/scripts/restore.sh <dosya> hedef_db --overwrite` |

Öneriler:
- Günlük yedek + yönetilen PostgreSQL'de PITR (WAL arşivi). Hedef: RPO ≤ 24 saat (PITR ile ≤ 5 dk), RTO ≤ 1 saat.
- Yedekleri şifreli, ayrı hesap/bölgedeki depolamada tutun; `.sha256` dosyasıyla birlikte saklayın.
- Ayda bir `verify-backup.sh` ile geri yükleme tatbikatı yapın ve sonucu kaydedin.
- Geri yüklenen veritabanında `prisma migrate status` çalıştırın; uygulama rollerinin parolalarını yeniden atayın (roller küme düzeyindedir).
- `MFA_ENCRYPTION_KEY` ve `JWT_SECRET` veritabanı yedeğinde değildir; gizli yönetimde ayrıca yedeklenmelidir.

Yerelde doğrulandı: geliştirme veritabanı yedeklendi, geçici veritabanına geri yüklendi, satır sayıları ve RLS eşleşti; bozuk dosya SHA-256 kontrolünde reddedildi; mevcut veritabanının üzerine onaysız yazma engellendi.

## 8. İzleme ve olay müdahalesi

- Günlükler: API stdout (JSON değil, Nest formatı) → merkezi log sistemine aktarın. `Prisma` ve `Jobs` hata satırları için uyarı kurun.
- İzlenecekler: `/health/ready` başarısızlığı, `JobRun.status` `FAILED`/`PARTIAL`, `OutboundEmail.status=FAILED` artışı, `Notification.status=FAILED` artışı, 5xx oranı, giriş başarısızlıkları (`AuditLog action=auth.login_failed`).
- Hesap ele geçirme şüphesi: kullanıcının oturumlarını `Session` tablosundan kapatın (`revokedAt=now()`), parola sıfırlama gönderin.
- Geri alma: önceki imaja dönün; migration geri alınamazsa yedekten **yeni** veritabanına yükleyip bağlantıyı değiştirin.

## 9. Canlıya almadan önce yapılacaklar (eksikler)

- [ ] Gerçek ödeme sağlayıcısı (`PaymentProvider` arayüzü) ve fatura/e-Arşiv entegrasyonu
- [ ] SMTP sağlayıcısı, SPF/DKIM/DMARC kayıtları
- [ ] Meta WhatsApp Business hesabı, onaylı şablonlar (`randevu_onay`, `randevu_hatirlatma`, `randevu_iptal`)
- [ ] Hız sınırlayıcının Redis'e taşınması (çoklu örnek için)
- [ ] Hukuki metinlerin (KVKK, gizlilik, çerez) avukat onayı, VERBİS kaydı değerlendirmesi
- [ ] Sızma testi ve yük testi

## 10. Hostinger VPS kurulumu (proguzellik.com)

Dosyalar: `infra/production/` (compose, `.env.example`, betikler, Caddy bloğu). Sunucudaki yerleşim:

```
/opt/proguzellik/infra/production/   docker-compose.yml, .env (600), betikler
/opt/proguzellik/infra/scripts/      ortak yedek/geri yükleme betikleri
/opt/proguzellik/backups/            veritabanı yedekleri (700)
/opt/proguzellik/images/             önceki sürüm imaj arşivleri (son 3)
```

**Yalıtım:** proje adı `proguzellik-prod`, konteynerler `proguzellik-prod-*`, volume'lar `proguzellik_prod_pg`/`proguzellik_prod_redis`, iç ağ `proguzellik_prod_internal` (internal: internet çıkışı yok). Host'a hiçbir port yayınlanmaz. Yalnızca `web`, ortak `edge_proxy` ağına `proguzellik-web` adıyla bağlanır. Diğer projelerin veritabanı, Redis, volume ve ağları kullanılmaz; mevcut Caddy blokları ve global ayarlar değiştirilmez. Konteynerler salt okunur dosya sistemi, `no-new-privileges`, `cap_drop: ALL` ve bellek/CPU sınırlarıyla çalışır (toplam ~1.9 GB).

**Pasif entegrasyonlar:** compose `EMAIL_MODE`, `WHATSAPP_MODE`, `PAYMENT_MODE`, `AI_MODE` değerlerini `mock` olarak sabitler; API'nin internet çıkışı da yoktur. Kayıt `REGISTRATION_ENABLED=0` ile kapalıdır (Caddy bloğu ayrıca kayıt yolunu 403 ile engeller).

### İlk kurulum (her adım onayla; sırası önemli)
1. Mac'te imajları **sunucu mimarisi için** derleyin (VPS x86_64) ve taşıyın; sunucuda derleme yapılmaz (disk):
   ```bash
   V=$(git rev-parse --short HEAD)
   docker build --platform linux/amd64 -f apps/api/Dockerfile -t proguzellik-api:$V .
   docker build --platform linux/amd64 -f apps/web/Dockerfile -t proguzellik-web:$V .
   docker save proguzellik-api:$V proguzellik-web:$V | gzip | ssh <vps> 'gunzip | docker load'
   ```
2. `infra/production` ve `infra/scripts` klasörlerini `/opt/proguzellik/infra/` altına kopyalayın. `.env.example` → `.env`, `chmod 600`; tüm gizli değerleri sunucuda `openssl rand -hex 32` ile üretin, `APP_VERSION=$V`. `JWT_SECRET` ve **`MFA_ENCRYPTION_KEY`** değerlerini sunucu dışında güvenli bir yerde yedekleyin.
3. `infra/production/preflight.sh` — salt okunur kapasite/yalıtım/gizli değer kontrolü. **ENGEL** varsa durun.
4. `docker compose up -d postgres redis`
5. `docker compose run --rm migrate` (boş veritabanına migration; seed **çalıştırılmaz**, demo hesap/test verisi taşınmaz)
6. `infra/production/set-db-role-passwords.sh` (uygulama rollerine giriş izni)
7. `docker compose up -d api web` → `docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-api` = healthy
8. `docker compose run --rm -it api node dist/cli/create-owner.js --email <e-posta> --name "<Ad Soyad>"` → ilk girişte 2FA kurulumu
9. Yedek cron'u: `/etc/cron.d/proguzellik-backup` → `45 3 * * * root /opt/proguzellik/infra/production/backup.sh >> /opt/proguzellik/backups/backup.log 2>&1`; ilk yedekte `infra/scripts/verify-backup.sh` tatbikatı (`PG_CONTAINER=proguzellik-prod-postgres PGUSER=proguzellik_owner`).
10. DNS (Hostinger paneli): `@` A → VPS IP, `www` → aynı; TTL 300. Yayılmayı `dig +short proguzellik.com` ile doğrulayın.
11. Caddy: `/opt/edge/Caddyfile` yedeği alınır, `Caddyfile.proguzellik.snippet` içeriği **sona eklenir**, `caddy validate` ardından `caddy reload` (restart değil). Sertifika Let's Encrypt ile otomatik alınır.
12. Duman testi: `https://proguzellik.com/giris` açılır, sahip girişi + 2FA, `/kayit` "kayıtlar kapalı" gösterir, kayıt isteği 403.

### Yeni sürüm
1. `backup.sh` (yedek) → 2. `archive-image.sh <çalışan-sürüm>` (gece `docker image prune` önceki imajı silebilir) → 3. yeni imajları yükle → 4. `docker compose run --rm migrate node dist/cli/migrate.js status` ile bekleyenleri gör → 5. `.env`'de `APP_VERSION` güncelle → 6. `docker compose run --rm migrate` → 7. `docker compose up -d api web` → 8. duman testi.

### Geri dönüş (rollback)
- **Uygulama:** `infra/production/rollback.sh <önceki-sürüm>` — imaj yoksa arşivden yükler (SHA-256 doğrulamalı), `APP_VERSION`'ı değiştirir (`.env` yedeği alınır), yalnızca api+web'i yeniden oluşturur ve sağlıklı olmasını bekler. Veritabanına dokunmaz.
- **Veritabanı:** Migration'lar geri alınamaz. Yeni sürümün migration'ı eski sürümle uyumsuzsa: uygulamayı durdurun (`docker compose stop api web`), sürüm öncesi yedeği **yeni** veritabanına yükleyin (`PG_CONTAINER=proguzellik-prod-postgres PGUSER=proguzellik_owner infra/scripts/restore.sh <yedek> proguzellik_rb`), `set-db-role-passwords.sh` çalıştırın, `.env`'de `PG_DB=proguzellik_rb` yapıp önceki sürümle başlatın. Eski veritabanı inceleme için silinmeden kalır.
- **Yayından kaldırma:** Caddy yedeğine dönüp `caddy reload`; diğer siteler etkilenmez. Gerekirse DNS park adresine döndürülür.

### Mac'te doğrulandı (27.10.2026)
Geçici sırlarla `infra/production` yapısı uçtan uca denendi (amd64 imajlar): migration ayrı servisle uygulandı, API/web salt okunur dosya sisteminde sağlıklı başladı, API'de `DATABASE_URL` yok ve internet çıkışı kapalı, `/kayit` kapalı mesajı ve kayıt isteği 403, sahip CLI'si ilk çalıştırmada oluşturdu / ikincide değiştirmedi / farklı e-postayla ikinci hesabı reddetti, demo verisi 0, sahip girişi Secure+HttpOnly çerezle başarılı, yedek + geri yükleme doğrulaması başarılı, arşivden geri dönüş başarılı. Test ortamı ardından silindi.
