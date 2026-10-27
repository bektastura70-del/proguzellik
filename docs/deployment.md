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
| `WHATSAPP_*`, `PAYMENT_MODE`, `AI_MODE` | Entegrasyonlar; varsayılanları test modudur |

Denetim: `pnpm --filter @proguzellik/api build && NODE_ENV=production pnpm --filter @proguzellik/api env:check`. `NODE_ENV=production` iken engelleyici hata varsa API **başlamaz**.

## 4. Derleme ve çalıştırma

Docker imajları (monorepo kökünden):
```bash
docker build -f apps/api/Dockerfile -t proguzellik-api .
docker build -f apps/web/Dockerfile -t proguzellik-web .
```
Docker olmadan: `pnpm install --frozen-lockfile && pnpm turbo run build`, ardından `node apps/api/dist/main.js` ve `pnpm --filter @proguzellik/web start`.

Sürüm sırası: (1) yedek al → (2) `prisma migrate deploy` → (3) API'yi güncelle → (4) web'i güncelle → (5) duman testi.

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
